// Server process lifecycle: spawn, health wait, log ring buffer, tree kill.
import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { buildArgs } from "./launch-config.ts";
import type { AppConfig, ResolvedConfig } from "./types.ts";

export interface RunningServer {
  proc: Bun.Subprocess;
  config: ResolvedConfig;
  url: string;
  pid: number;
  startedAt: number;
  logs: string[];
  logFile: string;
}

let current: RunningServer | undefined;

export function getRunningServer(): RunningServer | undefined {
  return current;
}

async function portInUse(host: string, port: number): Promise<boolean> {
  try {
    const conn = await Bun.connect({
      hostname: host,
      port,
      socket: { data() {}, close() {}, error() {} },
    });
    conn.end();
    return true;
  } catch {
    return false;
  }
}

// exllamav3 does not take llama-server flags. Spawn its own launcher (the
// deployment-kit start.ps1) and hand it the full per-config knobs through
// environment variables (start.ps1 prefers env over .env).
function spawnExllamav3(resolved: ResolvedConfig, host: string, port: number, env: Record<string, string | undefined>): Bun.Subprocess {
  if (!resolved.model.dir) throw new Error("exllamav3 configs must set model.dir");
  const script = resolved.binaryPath; // start.ps1 path resolved via binaries override
  const cfgEnv: Record<string, string> = {
    MODEL_DIR: resolved.model.dir,
    HOST: host,
    PORT: String(port),
    CONTEXT_SIZE: String(resolved.ctx_size ?? 196608),
  };
  if (resolved.cache_quant) cfgEnv.CACHE_QUANT = resolved.cache_quant;
  if (resolved.draft_mode) cfgEnv.DRAFT = resolved.draft_mode;
  return Bun.spawn(["pwsh", "-NoProfile", "-File", script], {
    cwd: dirname(script),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, ...cfgEnv },
  });
}

export async function launchServer(resolved: ResolvedConfig, appCfg: AppConfig, urlOverride?: string): Promise<RunningServer> {
  if (current) throw new Error(`A server is already running (${current.config.name}, pid ${current.pid}). Stop it first.`);
  const host = appCfg.server.host;
  const port = resolved.port || appCfg.server.port;
  const url = urlOverride ?? `http://${host}:${port}`;
  if (await portInUse(host === "0.0.0.0" ? "127.0.0.1" : host, port)) {
    throw new Error(`Port ${port} is already in use — refusing to start. Stop the other server or change the port.`);
  }
  if (appCfg.gpu_power_limit_watts) {
    try {
      const p = Bun.spawn(["nvidia-smi", "-pl", String(appCfg.gpu_power_limit_watts)], { stdout: "ignore", stderr: "ignore" });
      await p.exited;
    } catch {
      // ignore
    }
  }

  const env = { ...process.env, ...resolved.env };
  const proc =
    resolved.build === "exllamav3"
      ? spawnExllamav3(resolved, host, port, env)
      : Bun.spawn([resolved.binaryPath, ...buildArgs(resolved, host, port)], {
          stdout: "pipe",
          stderr: "pipe",
          env,
        });

  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  await mkdir("logs", { recursive: true });
  const logFile = join("logs", `${resolved.name}-${ts}.log`);
  const logs: string[] = [];

  const pump = (stream: ReadableStream<Uint8Array>) => {
    void (async () => {
      const decoder = new TextDecoder();
      let buf = "";
      for await (const chunk of stream) {
        buf += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, "");
          buf = buf.slice(idx + 1);
          logs.push(line);
          if (logs.length > 2000) logs.shift();
          try {
            await appendFile(logFile, line + "\n");
          } catch {
            // log write failure must not kill the session
          }
        }
      }
    })();
  };
  pump(proc.stdout as ReadableStream<Uint8Array>);
  pump(proc.stderr as ReadableStream<Uint8Array>);

  const running: RunningServer = {
    proc,
    config: resolved,
    url,
    pid: proc.pid,
    startedAt: Date.now(),
    logs,
    logFile,
  };
  current = running;
  return running;
}

export async function waitForHealth(url: string, timeoutSec: number, shouldAbort?: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (shouldAbort?.()) return false;
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await Bun.sleep(1000);
  }
  return false;
}

// Kill whatever process listens on this port. Covers orphans our own child
// spawn left behind (kit start.ps1 grandchildren survive a pwsh tree kill)
// and stale manually-launched servers - the recurring "bench talks to the
// wrong server" failure.
async function listeningPids(port: number): Promise<string[]> {
  const p = Bun.spawn(["cmd", "/c", "netstat -ano"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out
    .split("\n")
    .filter((l) => l.includes(`:${port} `) && l.includes("LISTENING"))
    .map((l) => l.trim().split(/\s+/).pop() ?? "")
    .filter((pid) => /^\d+$/.test(pid) && pid !== "0" && pid !== "4");
}

async function killPortOwner(port: number): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    const pids = new Set(await listeningPids(port));
    for (const pid of pids) {
      const k = Bun.spawn(["taskkill", "/PID", pid, "/F"], { stdout: "ignore", stderr: "ignore" });
      await k.exited;
    }
    if (pids.size > 0) {
      // A force-killed listener leaves the socket in a short grace period;
      // launchServer's bind check would still see it. Poll until released.
      for (let i = 0; i < 20; i++) {
        if ((await listeningPids(port)).length === 0) break;
        await Bun.sleep(500);
      }
    }
  } catch {
    // best effort
  }
}

// Own-child kill plus port-owner kill. `port` (or the running config's port)
// selects the listener to clear, so callers stop foreign servers on the port
// they are about to use.
export async function stopServer(port?: number): Promise<void> {
  const s = current;
  current = undefined;
  if (s) {
    try {
      s.proc.kill();
    } catch {
      // already dead
    }
    const exited = await Promise.race([s.proc.exited, Bun.sleep(3000).then(() => null)]);
    if (exited === null && process.platform === "win32") {
      try {
        const k = Bun.spawn(["taskkill", "/PID", String(s.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
        await k.exited;
      } catch {
        // best effort
      }
    }
  }
  const p = port ?? s?.config.port;
  if (p) await killPortOwner(p);
}
