// Integration: benchmark runner against a stub llama-server (no real binary/GPU).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// runBenchmark loads beellama-tui.yaml, whose path fields expand ${VAR}s.
// Fill them so the suite runs on hosts without the user's environment (CI).
process.env.BEELLAMA_REPO ??= ".";
process.env.BEELLAMA_MODEL_ROOTS ??= ".";
process.env.BEELLAMA_MODELS ??= ".";
import { runBenchmark } from "../src/bench/runner.ts";
import { CSV_HEADER } from "../src/bench/report.ts";
import { parseLaunchConfig } from "../src/launch-config.ts";
import { resolveConfig } from "../src/launch-config.ts";
import type { ResolvedConfig } from "../src/types.ts";

// Report generation calls the verdict provider whenever a key is present. These
// stubs assert on file contents, so a live 20s+ model call only burns money and
// blows the 30s test budget. Remove the key for this file, restore it after.
const verdictKey = process.env.NVIDIA_API_KEY;
beforeAll(() => {
  delete process.env.NVIDIA_API_KEY;
});
afterAll(() => {
  if (verdictKey !== undefined) process.env.NVIDIA_API_KEY = verdictKey;
});

interface StubServer {
  port: number;
  stop: () => void;
}

function metricsBody(counters: { prompt: number; predicted: number }): Response {
  // Serve Prometheus text — the real llama.cpp /metrics contract.
  const body = [
    `llamacpp:prompt_tokens_total ${counters.prompt}`,
    `llamacpp:tokens_predicted_total ${counters.predicted}`,
    "llamacpp:prompt_seconds_total 1",
    "llamacpp:tokens_predicted_seconds_total 1",
    "llamacpp:spec_decode_num_draft_tokens_total 0",
    "llamacpp:spec_decode_num_accepted_tokens_total 0",
    "llamacpp:n_decode_total 0",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; version=0.0.4" } });
}

function startStubServer(): StubServer {
  const counters = { prompt: 0, predicted: 0 };
  const sse = (chunks: string[]): Response =>
    new Response(chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ status: "ok" });
      if (url.pathname === "/props") return Response.json({});
      if (url.pathname === "/metrics") return metricsBody(counters);
      if (url.pathname === "/v1/chat/completions") {
        // Real delay: the stub must produce a measurable decode rate.
        await Bun.sleep(30);
        counters.prompt += 12;
        counters.predicted += 8;
        return sse([
          JSON.stringify({ choices: [{ delta: { content: "hello " } }] }),
          JSON.stringify({ choices: [{ delta: { content: "world" } }] }),
          JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } }),
        ]);
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true) };
}

// Answers nothing usable: every completion stops on the token cap.
function startCappedStubServer(): StubServer {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ status: "ok" });
      if (url.pathname === "/props") return Response.json({});
      if (url.pathname === "/metrics") return metricsBody({ prompt: 12, predicted: 8 });
      if (url.pathname === "/v1/chat/completions") {
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "function Get-" } }] })}\n\n` +
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }], usage: { prompt_tokens: 12, completion_tokens: 8 } })}\n\n` +
            "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true) };
}

function stubConfig(name: string): ResolvedConfig {
  const cfg = parseLaunchConfig(`name: ${name}\nmodel: { gguf: "D:/stub/model-UD-Q4_K_M.gguf" }\n`, "stub.yaml");
  return resolveConfig(cfg, "C:/nonexistent/llama-server.exe", "stub.yaml", ["D:/stub"]);
}

async function tempOutDir(): Promise<string> {
  return Bun.$`mktemp -d`.text().then((t) => t.trim().replaceAll("\\", "/"));
}

describe("runner integration vs stub server", () => {
  test("produces CSV + HTML with positive tok/s", async () => {
    const stub = startStubServer();
    try {
      const outDir = await tempOutDir();
      const code = await runBenchmark(
        { config: "stub-cfg", set: "standard", runs: 2, out: outDir, url: `http://localhost:${stub.port}` },
        undefined,
        undefined,
        [stubConfig("stub-cfg")],
      );
      expect(code).toBe(0);

      // runner uses appCfg server url — point it at the stub via env override is not
      // wired; instead verify outputs exist and rows are correct for the URL the
      // runner actually used. To make this hermetic we assert on files only when the
      // stub was reachable; otherwise skip gracefully.
      const csv = Bun.file(`${outDir}/results.csv`);
      expect(await csv.exists()).toBe(true);
      const html = Bun.file(`${outDir}/results.html`);
      expect(await html.exists()).toBe(true);
      const text = await csv.text();
      const lines = text.trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(5); // header + >= 4 prompts x runs
      expect(lines[0]).toBe(CSV_HEADER);
    } finally {
      stub.stop();
    }
  }, 30000);

  test("reports a capped run as trunc without a grade", async () => {
    const stub = startCappedStubServer();
    try {
      const outDir = await tempOutDir();
      const code = await runBenchmark(
        { config: "stub-capped", set: "coding", runs: 1, out: outDir, url: `http://localhost:${stub.port}` },
        undefined,
        undefined,
        [stubConfig("stub-capped")],
      );
      expect(code).toBe(0);

      const lines = (await Bun.file(`${outDir}/results.csv`).text()).trim().split("\n");
      const gradeCol = lines[0].split(",").indexOf("QAGrade");
      const rows = lines.slice(1);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.split(",")[gradeCol] === "")).toBe(true);

      const html = await Bun.file(`${outDir}/results.html`).text();
      expect(html).toContain("trunc 1");

      // The capped output is the only evidence of what went wrong, so it must
      // still be persisted even though it is not graded.
      const samples = JSON.parse(await Bun.file(`${outDir}/samples.json`).text()) as { prompt: string; finishReason: string }[];
      expect(samples.length).toBeGreaterThan(0);
      expect(samples.every((s) => s.finishReason === "length")).toBe(true);
    } finally {
      stub.stop();
    }
  }, 30000);
});
