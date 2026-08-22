// Streaming benchmark runner: warmup, per-prompt runs with retries, metrics scrape.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAppConfig } from "../config.ts";
import { loadAll } from "../cli.ts";
import { resolveBinary } from "../binary.ts";
import { deriveFacets, resolveConfig } from "../launch-config.ts";
import { launchServer, stopServer, waitForHealth } from "../server.ts";
import { fetchMetrics } from "../metrics.ts";
import { loadPromptSet } from "./prompts.ts";
import type { BenchResultRow, QualityResult, ResolvedConfig } from "../types.ts";
import { runQualityAnalysis } from "./quality.ts";
import type { BenchCliOpts } from "../cli.ts";
import { writeReport } from "./report.ts";

export interface StreamMeasure {
  prompt: string;
  type: string;
  promptTokens: number;
  completionTokens: number;
  wallMs: number;
  ttftMs: number;
  content: string;
}

// POST /v1/chat/completions stream:true; TTFT = ms to first chunk.
export async function runPromptStreaming(
  messages: { role: string; content: string }[],
  url: string,
  maxTokens: number,
  timeoutSec: number,
): Promise<StreamMeasure> {
  const body = JSON.stringify({
    model: "default",
    messages,
    max_tokens: maxTokens,
    temperature: 0.6,
    top_k: 20,
    stream: true,
    stream_options: { include_usage: true },
  });
  const started = Date.now();
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutSec * 1000),
  });
  if (!res.ok || !res.body) throw new Error(`chat completions returned ${res.status}`);

  let ttftMs = -1;
  let completionTokens = 0;
  let promptTokens = 0;
  let content = "";
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string; reasoning_content?: string } }[];
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
        const tok = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.delta?.reasoning_content;
        if (tok) {
          if (ttftMs < 0) ttftMs = Date.now() - started;
          content += tok;
        }
        if (parsed.usage) {
          promptTokens = parsed.usage.prompt_tokens;
          completionTokens = parsed.usage.completion_tokens;
        }
      } catch {
        // skip malformed chunk
      }
    }
  }
  const wallMs = Date.now() - started;
  if (completionTokens === 0 && content.length > 0) {
    completionTokens = Math.max(1, Math.round(content.length / 4));
  }
  return { prompt: "", type: "", promptTokens, completionTokens, wallMs, ttftMs: ttftMs < 0 ? wallMs : ttftMs, content };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1));
}

export interface BenchProgress {
  configIndex: number;
  configCount: number;
  configName: string;
  promptIndex: number;
  promptCount: number;
  runIndex: number;
  runCount: number;
  tokPerSec: number;
  phase: "starting" | "warming" | "running" | "stopping" | "done" | "failed";
  note?: string;
}

export async function runBenchmark(
  opts: BenchCliOpts,
  onProgress?: (p: BenchProgress) => void,
  shouldAbort?: () => boolean,
  configsOverride?: ResolvedConfig[],
): Promise<number> {
  const appCfg = await loadAppConfig();
  const setName = (opts.set as "standard" | "coding" | "longctx") ?? "standard";
  const prompts = await loadPromptSet(setName);
  const bench = appCfg.benchmark;
  const runs = opts.runs ?? bench.runs;

  let resolvedList: ResolvedConfig[];
  if (configsOverride) {
    resolvedList = configsOverride;
  } else {
    const { configs } = await loadAll(appCfg);
    const selected = configs.filter((c) => c.name === opts.config);
    if (selected.length === 0) {
      console.error(`config not found: ${opts.config}`);
      return 1;
    }
    resolvedList = [];
    for (const c of selected) {
      const binaryPath = resolveBinary(c.build, appCfg);
      resolvedList.push(resolveConfig(c, binaryPath, "", appCfg.model_roots));
    }
  }

  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const outDir = opts.out ?? join(process.cwd(), "benchmarks", ts);
  await mkdir(outDir, { recursive: true });

  const allRows: BenchResultRow[] = [];
  const contents: { config: string; prompt: string; type: string; content: string }[] = [];
  const failures: string[] = [];

  const baseUrl = opts.url ?? serverUrl(appCfg);
  for (let ci = 0; ci < resolvedList.length; ci++) {
    if (shouldAbort?.()) break;
    const rc = resolvedList[ci];
    const facets = deriveFacets(rc, appCfg.model_roots);
    onProgress?.({ configIndex: ci, configCount: resolvedList.length, configName: rc.name, promptIndex: 0, promptCount: prompts.length, runIndex: 0, runCount: runs, tokPerSec: 0, phase: "starting" });

    // A manually-launched server would otherwise answer for every config.
    await stopServer();
    if (!opts.url) {
      try {
        await launchServer(rc, appCfg);
      } catch (e) {
        failures.push(`${rc.name}: ${e instanceof Error ? e.message : String(e)}`);
        onProgress?.({ configIndex: ci, configCount: resolvedList.length, configName: rc.name, promptIndex: 0, promptCount: prompts.length, runIndex: 0, runCount: runs, tokPerSec: 0, phase: "failed", note: e instanceof Error ? e.message : String(e) });
        continue;
      }

      const healthy = await waitForHealth(baseUrl, bench.timeout_sec);
      if (!healthy) {
        failures.push(`${rc.name}: health check timed out after ${bench.timeout_sec}s`);
        onProgress?.({ configIndex: ci, configCount: resolvedList.length, configName: rc.name, promptIndex: 0, promptCount: prompts.length, runIndex: 0, runCount: runs, tokPerSec: 0, phase: "failed", note: "health timeout" });
        await stopServer();
        continue;
      }
    }

    // Warmup
    onProgress?.({ configIndex: ci, configCount: resolvedList.length, configName: rc.name, promptIndex: 0, promptCount: prompts.length, runIndex: 0, runCount: runs, tokPerSec: 0, phase: "warming" });
    for (let w = 0; w < bench.warmup_runs && !shouldAbort?.(); w++) {
      try {
        await runPromptStreaming(prompts[0].messages, baseUrl, bench.warmup_tokens, bench.timeout_sec);
      } catch {
        break;
      }
    }

    // Measured runs
    for (let pi = 0; pi < prompts.length; pi++) {
      const p = prompts[pi];
      for (let ri = 0; ri < runs && !shouldAbort?.(); ri++) {
        onProgress?.({ configIndex: ci, configCount: resolvedList.length, configName: rc.name, promptIndex: pi + 1, promptCount: prompts.length, runIndex: ri + 1, runCount: runs, tokPerSec: 0, phase: "running" });
        let attempt = 0;
        for (;;) {
          if (shouldAbort?.()) break;
          try {
            const m = await runPromptStreaming(p.messages, baseUrl, bench.max_tokens, bench.timeout_sec * 2);
            const decodeMs = m.wallMs > m.ttftMs ? m.wallMs - m.ttftMs : m.wallMs;
            const row: BenchResultRow = {
              Config: rc.name,
              Label: rc.label ?? rc.name,
              Run: ri + 1,
              Prompt: p.name,
              Type: p.type,
              PromptTokens: m.promptTokens,
              CompletionTokens: m.completionTokens,
              WallTimeMs: m.wallMs,
              TTFT_Ms: m.ttftMs,
              TokPerSec: m.wallMs > 0 ? Number(((m.completionTokens / m.wallMs) * 1000).toFixed(2)) : 0,
              DecodeTokPerSec: decodeMs > 0 ? Number(((m.completionTokens / decodeMs) * 1000).toFixed(2)) : 0,
            };
            allRows.push(row);
            contents.push({ config: rc.name, prompt: p.name, type: p.type, content: m.content });
            break;
          } catch (e) {
            attempt++;
            if (attempt > bench.retries) {
              failures.push(`${rc.name}/${p.name} run ${ri + 1}: ${e instanceof Error ? e.message : String(e)}`);
              break;
            }
          }
        }
      }
    }


    // Scrape /metrics snapshot
    try {
      const snap = await fetchMetrics(baseUrl);
      await writeFile(join(outDir, `metrics-${rc.name}.txt`), JSON.stringify(snap, null, 2));
    } catch {
      // non-fatal
    }

    onProgress?.({ configIndex: ci, configCount: resolvedList.length, configName: rc.name, promptIndex: prompts.length, promptCount: prompts.length, runIndex: runs, runCount: runs, tokPerSec: 0, phase: "stopping" });
    await stopServer();
    if (bench.config_cooldown_sec > 0 && ci < resolvedList.length - 1 && !shouldAbort?.()) {
      await Bun.sleep(bench.config_cooldown_sec * 1000);
    }
  }


  // Quality analysis: one graded sample per config+prompt pair, applied to
  // every run row of that pair. Only Code/Coding prompts carry gradable output.
  const qaIdx = new Map<string, number>();
  const codeSamples: { prompt: string; content: string }[] = [];
  for (const c of contents) {
    if (c.type !== "Code" && c.type !== "Coding") continue;
    const key = `${c.config}/${c.prompt}`;
    if (!qaIdx.has(key)) {
      qaIdx.set(key, codeSamples.length);
      codeSamples.push({ prompt: c.prompt, content: c.content });
    }
  }
  if (codeSamples.length > 0) {
    const qaResults = await runQualityAnalysis(codeSamples, appCfg);
    for (const row of allRows) {
      const si = qaIdx.get(`${row.Config}/${row.Prompt}`);
      const q = si !== undefined ? qaResults[si] : undefined;
      if (q) {
        row.QASyntaxOk = q.syntaxOk;
        row.QAPSAErrors = q.psaErrors;
        row.QAPSAWarnings = q.psaWarnings;
        row.QAIdiomScore = q.idiomScore;
        row.QAGrade = q.grade;
      }
    }
  }

  await writeReport(outDir, allRows, resolvedList.map((r) => r.name), failures, setName);

  if (!onProgress) {
    console.log(`results: ${join(outDir, "results.csv")}`);
    console.log(`report:  ${join(outDir, "results.html")}`);
  }
  onProgress?.({ configIndex: resolvedList.length, configCount: resolvedList.length, configName: "", promptIndex: 0, promptCount: 0, runIndex: 0, runCount: 0, tokPerSec: 0, phase: "done" });

  // Open report in browser (headless mode only)
  if (!onProgress) {
    try {
      const p = Bun.spawn(["cmd", "/c", "start", "", join(outDir, "results.html")], { stdout: "ignore", stderr: "ignore" });
      await p.exited;
    } catch {
      // ignore
    }
  }
  return 0;
}

function serverUrl(appCfg: { server: { host: string; port: number } }): string {
  const host = appCfg.server.host === "0.0.0.0" ? "127.0.0.1" : appCfg.server.host;
  return `http://${host}:${appCfg.server.port}`;
}

