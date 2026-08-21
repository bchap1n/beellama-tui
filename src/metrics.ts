// /metrics polling, session stats accumulation, atomic persistence.
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { MetricsSnapshot, SessionStats } from "./types.ts";

const POLL_MS = 5000;

export async function fetchMetrics(url: string): Promise<MetricsSnapshot> {
  const res = await fetch(`${url}/metrics`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`/metrics returned ${res.status}`);
  return (await res.json()) as MetricsSnapshot;
}

export function deltaTokPerSec(prev: number, now: number, dtSec: number): number {
  if (dtSec <= 0) return 0;
  return (now - prev) / dtSec;
}

export class SessionTracker {
  private timer: NodeJS.Timeout | undefined;
  private lastSnap: MetricsSnapshot | undefined;
  private lastAt = 0;
  private startedAt = Date.now();
  stats: SessionStats | undefined;

  start(configName: string, pid: number, url: string): void {
    this.stop();
    this.startedAt = Date.now();
    this.lastSnap = undefined;
    this.lastAt = 0;
    this.stats = {
      config: configName,
      pid,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      promptTokens: 0,
      outputTokens: 0,
      outputTokensPerSec: 0,
      specDraftTokens: 0,
      specAcceptedTokens: 0,
      elapsedSec: 0,
    };
    this.timer = setInterval(() => {
      void this.poll(url);
    }, POLL_MS);
    void this.poll(url);
  }

  private async poll(url: string): Promise<void> {
    try {
      const snap = await fetchMetrics(url);
      const now = Date.now();
      if (this.stats) {
        if (this.lastSnap) {
          const dt = (now - this.lastAt) / 1000;
          this.stats.outputTokensPerSec = deltaTokPerSec(this.lastSnap.tokens_predicted_total, snap.tokens_predicted_total, dt);
        }
        this.stats.promptTokens = snap.prompt_tokens_total;
        this.stats.outputTokens = snap.tokens_predicted_total;
        this.stats.specDraftTokens = snap.spec_decode_num_draft_tokens_total;
        this.stats.specAcceptedTokens = snap.spec_decode_num_accepted_tokens_total;
        this.stats.elapsedSec = Math.round((now - this.startedAt) / 1000);
        this.stats.updatedAt = new Date().toISOString();
        await persistCurrent(this.stats);
      }
      this.lastSnap = snap;
      this.lastAt = now;
    } catch {
      // server busy or down — keep last known stats
    }
  }

  async stop(): Promise<string | undefined> {
    clearInterval(this.timer);
    this.timer = undefined;
    const s = this.stats;
    this.stats = undefined;
    if (!s) return undefined;
    return archiveSession(s);
  }
}

async function persistCurrent(stats: SessionStats): Promise<void> {
  await mkdir("sessions", { recursive: true });
  const tmp = join("sessions", "current.json.tmp");
  await Bun.write(tmp, JSON.stringify(stats, null, 2));
  await rename(tmp, join("sessions", "current.json"));
}

async function archiveSession(stats: SessionStats): Promise<string> {
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  await mkdir("sessions", { recursive: true });
  const dest = join("sessions", `${ts}-${stats.config}.json`);
  await Bun.write(dest, JSON.stringify(stats, null, 2));
  try {
    await rm(join("sessions", "current.json"));
  } catch {
    // already gone
  }
  return dest;
}

export async function readCurrentSession(): Promise<SessionStats | undefined> {
  for (const dir of [process.cwd(), "C:/Users/brock/Documents/github/beellama-tui"]) {
    try {
      const f = Bun.file(join(dir, "sessions", "current.json"));
      if (await f.exists()) return (await f.json()) as SessionStats;
    } catch {
      // try next
    }
  }
  return undefined;
}
