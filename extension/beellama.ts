// @ts-nocheck
// /bee-stats — report local beellama session token stats + remote session usage.
// Drop-in omp extension; install with scripts/install-extension.ps1.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";

interface SessionStats {
  config: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  promptTokens: number;
  outputTokens: number;
  outputTokensPerSec: number;
  specDraftTokens: number;
  specAcceptedTokens: number;
  elapsedSec: number;
}

async function readCurrentSession(): Promise<SessionStats | undefined> {
  const candidates = [
    join(process.cwd(), "sessions", "current.json"),
    join(homedir(), "Documents", "github", "beellama-tui", "sessions", "current.json"),
  ];
  for (const p of candidates) {
    try {
      const f = Bun.file(p);
      if (await f.exists()) return (await f.json()) as SessionStats;
    } catch {
      // try next
    }
  }
  return undefined;
}

async function fetchLiveMetrics(): Promise<Record<string, number> | undefined> {
  try {
    const res = await fetch("http://localhost:8082/metrics", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return undefined;
    return (await res.json()) as Record<string, number>;
  } catch {
    return undefined;
  }
}

export default function activate(pi: ExtensionAPI): void {
  pi.registerCommand("bee-stats", {
    description: "Show local beellama session tokens and remote session usage",
    handler: async (_args, ctx) => {
      const lines: string[] = [];
      let s = await readCurrentSession();
      if (!s) {
        const m = await fetchLiveMetrics();
        if (m) {
          lines.push(
            `local (live /metrics): ${m.tokens_predicted_total ?? 0} out · ${m.prompt_tokens_total ?? 0} prompt`,
          );
        } else {
          lines.push("local: no session file, no live server on :8082");
        }
      } else {
        const acceptPct =
          s.specDraftTokens > 0 ? `${((s.specAcceptedTokens / s.specDraftTokens) * 100).toFixed(0)}%` : "-";
        const mm = Math.floor(s.elapsedSec / 60);
        const ss = String(s.elapsedSec % 60).padStart(2, "0");
        lines.push(
          `local beellama [${s.config}] pid ${s.pid}`,
          `  output ${s.outputTokens.toLocaleString()} tok · avg ${s.outputTokensPerSec.toFixed(1)} tok/s · spec accept ${acceptPct} · up ${mm}:${ss}`,
          `  prompt ${s.promptTokens.toLocaleString()} tok`,
        );
      }

      try {
        const u = ctx.sessionManager.getUsageStatistics();
        lines.push(
          `remote session: in ${u.input.toLocaleString()} · out ${u.output.toLocaleString()} · cache r/w ${u.cacheRead.toLocaleString()}/${u.cacheWrite.toLocaleString()} · total ${u.totalTokens.toLocaleString()} · $${u.cost.toFixed(4)}`,
        );
      } catch {
        // usage stats unavailable
      }

      await ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
