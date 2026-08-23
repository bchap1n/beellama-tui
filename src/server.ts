// Server process lifecycle: spawn, health wait, log ring buffer, tree kill.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
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

  const args = buildArgs(resolved, host, port);
  const env = { ...process.env, ...resolved.env };
  const proc = Bun.spawn([resolved.binaryPath, ...args], {
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

export async function stopServer(): Promise<void> {
  const s = current;
  if (!s) return;
  current = undefined;
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
