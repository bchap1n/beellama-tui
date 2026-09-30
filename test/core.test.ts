// Unit tests: facets, quant regex, arg builder, CSV header, metrics delta, haystack, validation.
import { describe, expect, test, afterEach } from "bun:test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRoot } from "../src/approot.ts";
import { parseLaunchConfig, deriveFacets, buildArgs, quantOf, providerOf, resolveConfig, ConfigError } from "../src/launch-config.ts";
import { expandLongCtx } from "../src/bench/prompts.ts";
import { rowsToCsv, CSV_HEADER, writeReport, analysisVerdict } from "../src/bench/report.ts";
import { deltaTokPerSec, fetchMetrics } from "../src/metrics.ts";
import type { BenchResultRow, LaunchConfig } from "../src/types.ts";

const ROOTS = ["D:/.lmstudio/models", "C:/Users/brock/.lmstudio/models"];

describe("quant derivation", () => {
  test("compound AD-Q5_K-Q4_K", () => {
    expect(quantOf("Qwen3.8-27B-AD-Q5_K-Q4_K")).toEqual({ quant: "AD-Q5_K-Q4_K", model: "Qwen3.8-27B" });
  });
  test("UD-Q4_K_XL", () => {
    expect(quantOf("Muse-Glimmer-30B-UD-Q4_K_XL")).toEqual({ quant: "UD-Q4_K_XL", model: "Muse-Glimmer-30B" });
  });
  test("Q4_0 draft", () => {
    expect(quantOf("mtp-Qwen3.8-27B-Q4_0").quant).toBe("Q4_0");
  });
  test("IQ4_XS", () => {
    expect(quantOf("Ornith-1.5-35B-A3B-IQ4_XS").quant).toBe("IQ4_XS");
  });
});

describe("provider derivation", () => {
  test("nested unsloth path", () => {
    expect(providerOf("D:/.lmstudio/models/unsloth/qwen3.8-27B-gguf/x.gguf", ROOTS)).toBe("unsloth");
  });
  test("flat AtomicChat path", () => {
    expect(providerOf("D:\\.lmstudio\\models\\AtomicChat\\y.gguf", ROOTS)).toBe("AtomicChat");
  });
  test("override wins", () => {
    expect(providerOf("D:/.lmstudio/models/unsloth/x.gguf", ROOTS, "bartowski")).toBe("bartowski");
  });
  test("outside roots is unknown", () => {
    expect(providerOf("E:/models/foo/bar.gguf", ROOTS)).toBe("unknown");
  });
});

const SAMPLE_YAML = `
name: test-cfg
model: { gguf: "D:/.lmstudio/models/unsloth/repo/Test-27B-UD-Q4_K_M.gguf" }
spec: { type: draft-mtp, draft_max: 2 }
ctx_size: 163840
batch: 4096
ubatch: 512
cache_k: kvarn4
cache_v: kvarn3
kv_tail_tokens: 1024
reasoning: true
reasoning_effort: low
sampling: { temp: 0.7, top_p: 0.80, top_k: 20 }
extra_args: ["--n-cpu-moe", "4"]
`;

function sampleCfg(): LaunchConfig {
  return parseLaunchConfig(SAMPLE_YAML, "test.yaml");
}

describe("arg builder", () => {
  test("matches migrated script flag style", () => {
    const args = buildArgs(sampleCfg(), "127.0.0.1", 8082);
    const expected = [
      "-m", "D:/.lmstudio/models/unsloth/repo/Test-27B-UD-Q4_K_M.gguf",
      "--spec-type", "draft-mtp",
      "--spec-draft-n-max", "2",
      "--port", "8082",
      "--host", "127.0.0.1",
      "--alias", "localmodel",
      "-np", "1",
      "--kv-unified",
      "-ngl", "all",
      "--ctx-size", "163840",
      "-b", "4096", "-ub", "512",
      "--cache-type-k", "kvarn4", "--cache-type-v", "kvarn3",
      "--kv-tail-tokens", "1024",
      "--flash-attn", "on",
      "--jinja",
      "--no-host", "--metrics", "--log-colors", "off",
      "--reasoning", "on",
      "--chat-template-kwargs", '{"preserve_thinking":true,"reasoning_effort":"low","reasoning_strength":"low"}',
      "--temp", "0.7", "--top-p", "0.8", "--top-k", "20",
      "--n-cpu-moe", "4",
    ];
    expect(args).toEqual(expected);
  });
  test("dflash emits spec-draft-model and spec-draft-ngl", () => {
    const cfg = parseLaunchConfig(`
name: d
model: { gguf: "D:/m/unsloth/Muse-Glimmer-30B-UD-Q4_K_XL.gguf" }
draft: { gguf: "D:/m/meta-models/z-labs/dflash.gguf" }
spec: { type: draft-dflash, draft_max: 15 }
`, "d.yaml");
    const args = buildArgs(cfg, "127.0.0.1", 8082);
    expect(args).toContain("--spec-draft-model");
    expect(args[args.indexOf("--spec-draft-model") + 1]).toBe("D:/m/meta-models/z-labs/dflash.gguf");
    expect(args[args.indexOf("--spec-draft-ngl") + 1]).toBe("all");
  });
  test("mmproj emits no-mmproj-offload", () => {
    const cfg = parseLaunchConfig(`
name: v
model: { gguf: "D:/m/Qwen3.8-27B-UD-Q4_K_S.gguf", mmproj: "D:/m/mmproj-BF16.gguf" }
`, "v.yaml");
    const args = buildArgs(cfg, "127.0.0.1", 8082);
    expect(args).toContain("--no-mmproj-offload");
  });
});

describe("facets", () => {
  test("full derivation", () => {
    const f = deriveFacets(sampleCfg(), ROOTS);
    expect(f.provider).toBe("unsloth");
    expect(f.quant).toBe("UD-Q4_K_M");
    expect(f.model).toBe("Test-27B");
    expect(f.ctx).toBe(163840);
    expect(f.think).toBe(true);
    expect(f.vision).toBe(false);
    expect(f.quality).toBe(false);
    expect(f.spec).toBe("mtp");
  });
});

describe("CSV header parity", () => {
  test("legacy header plus FinishReason column", () => {
    expect(CSV_HEADER).toBe(
      "Config,Label,Run,Prompt,Type,PromptTokens,CompletionTokens,WallTimeMs,TTFT_Ms,TokPerSec,DecodeTokPerSec,NeedleHit,QASyntaxOk,QAPSAErrors,QAPSAWarnings,QAIdiomScore,QAGrade,FinishReason",
    );
  });
  test("rows render with empty QA and FinishReason columns when absent", () => {
    const csv = rowsToCsv([{
      Config: "c", Label: "l", Run: 1, Prompt: "p", Type: "Code",
      PromptTokens: 10, CompletionTokens: 20, WallTimeMs: 1000, TTFT_Ms: 50,
      TokPerSec: 20, DecodeTokPerSec: 21,
    }]);
    expect(csv.split("\n")[1]).toBe("c,l,1,p,Code,10,20,1000,50,20,21,,,,,,,");
  });
});

describe("report analysis input", () => {
  // The analysis model only sees these lines. A missing grade must not be
  // reported as a token cap unless a run truly stopped on one - otherwise the
  // verdict invents truncation for a prompt that answered normally.
  test("names the token cap only for runs that hit it", async () => {
    const base = {
      Config: "cfg", Label: "cfg", Run: 1, Type: "Coding",
      PromptTokens: 10, CompletionTokens: 20, TTFT_Ms: 100,
      QASyntaxOk: true, QAPSAErrors: 0, QAPSAWarnings: 0,
    };
    const rows: BenchResultRow[] = [
      { ...base, Prompt: "ps_graded", WallTimeMs: 1000, TokPerSec: 50, DecodeTokPerSec: 51, QAIdiomScore: 80, QAGrade: "A", FinishReason: "stop" },
      { ...base, Prompt: "ps_capped", WallTimeMs: 2000, TokPerSec: 40, DecodeTokPerSec: 41, FinishReason: "length" },
      { ...base, Prompt: "ps_bridge_down", WallTimeMs: 3000, TokPerSec: 30, DecodeTokPerSec: 31, QASyntaxOk: undefined, QAPSAErrors: undefined, QAPSAWarnings: undefined, FinishReason: "stop" },
    ];
    const cfg = resolveConfig(
      parseLaunchConfig(`name: cfg\nmodel: { gguf: "D:/stub/model-UD-Q4_K_M.gguf" }\n`, "stub.yaml"),
      "C:/nonexistent/llama-server.exe",
      "stub.yaml",
      ["D:/stub"],
    );

    const outDir = join(tmpdir(), "beellama-report-analysis");
    await mkdir(outDir, { recursive: true });
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    const realKey = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
      sent.push(String(init?.body ?? ""));
      return Promise.resolve(Response.json({ choices: [{ message: { content: "verdict" } }] }));
    }) as unknown as typeof fetch;
    try {
      await writeReport(outDir, rows, [cfg], [], "coding");
    } finally {
      globalThis.fetch = realFetch;
      if (realKey === undefined) delete process.env.NVIDIA_API_KEY;
      else process.env.NVIDIA_API_KEY = realKey;
    }

    expect(sent.length).toBe(1);
    const body = JSON.parse(sent[0]) as { messages: { content: string }[] };
    const lines = body.messages[1].content.split("\n");
    const lineFor = (prompt: string) => lines.find((l) => l.includes(`- ${prompt}:`));
    expect(lineFor("ps_graded")).toBe("  - ps_graded: 50.0 tok/s grade A idiom 80%");
    expect(lineFor("ps_capped")).toBe("  - ps_capped: 40.0 tok/s ungraded - 1/1 run(s) hit the token cap");
    expect(lineFor("ps_bridge_down")).toBe("  - ps_bridge_down: 30.0 tok/s");
  });
});

describe("report harness provenance", () => {
  // Coding grades follow OMP's PowerShell conventions, so a coding report must
  // name the OMP build. Other sets are engine-only and must not gain the field.
  const base = {
    Config: "cfg", Label: "cfg", Run: 1, Type: "Coding",
    PromptTokens: 10, CompletionTokens: 20, WallTimeMs: 1000, TTFT_Ms: 100,
    TokPerSec: 50, DecodeTokPerSec: 51, FinishReason: "stop",
    QASyntaxOk: true, QAPSAErrors: 0, QAPSAWarnings: 0, QAIdiomScore: 80, QAGrade: "A",
  };
  const cfg = () =>
    resolveConfig(
      parseLaunchConfig(`name: cfg\nmodel: { gguf: "D:/stub/model-UD-Q4_K_M.gguf" }\n`, "stub.yaml"),
      "C:/nonexistent/llama-server.exe",
      "stub.yaml",
      ["D:/stub"],
    );

  async function subtitleFor(setName: string, harness?: string): Promise<string> {
    const outDir = join(tmpdir(), `beellama-harness-${setName}`);
    await mkdir(outDir, { recursive: true });
    await writeReport(outDir, [{ ...base, Prompt: "p1" }], [cfg()], [], setName, "beellama.cpp 1.2.3", harness);
    const html = await Bun.file(join(outDir, "results.html")).text();
    return html.match(/<div class="sub">(.*?)<\/div>/)?.[1] ?? "";
  }

  const realKey = process.env.NVIDIA_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = realKey;
  });

  test("coding reports name the OMP harness", async () => {
    delete process.env.NVIDIA_API_KEY;
    const sub = await subtitleFor("coding", "omp 18.1.15");
    expect(sub).toContain("engine: beellama.cpp 1.2.3");
    expect(sub).toContain("harness: omp 18.1.15");
  });

  test("other sets stay engine-only", async () => {
    delete process.env.NVIDIA_API_KEY;
    for (const set of ["standard", "longctx"]) {
      const sub = await subtitleFor(set, "omp 18.1.15");
      expect(sub).toContain("engine: beellama.cpp 1.2.3");
      expect(sub).not.toContain("harness");
    }
  });
});

describe("Verdict failure reporting", () => {
  // A swallowed error made every failure read "NVIDIA_API_KEY not set",
  // which sent us hunting a key that was present. The reason must be truthful.
  const realKey = process.env.NVIDIA_API_KEY;
  const realFetch = globalThis.fetch;
  const promptsDir = join(appRoot(), "prompts");

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = realKey;
  });

  test("names the missing key when it is absent", async () => {
    delete process.env.NVIDIA_API_KEY;
    const out = await analysisVerdict("data", 1, promptsDir);
    expect(out.text).toBeUndefined();
    expect(out.reason).toContain("NVIDIA_API_KEY");
  });

  test("reports the HTTP status instead of blaming the key", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = (() =>
      Promise.resolve(new Response("rate limited", { status: 429 }))) as unknown as typeof fetch;
    const out = await analysisVerdict("data", 1, promptsDir);
    expect(out.text).toBeUndefined();
    expect(out.reason).toContain("429");
    expect(out.reason).toContain("rate limited");
  });

  test("reports a transport failure with its message", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as unknown as typeof fetch;
    const out = await analysisVerdict("data", 1, promptsDir);
    expect(out.text).toBeUndefined();
    expect(out.reason).toContain("ENOTFOUND");
  });

  test("returns the verdict text on success", async () => {
    process.env.NVIDIA_API_KEY = "test-key";
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({ choices: [{ message: { content: "OVERALL: fine" } }] }))) as unknown as typeof fetch;
    const out = await analysisVerdict("data", 1, promptsDir);
    expect(out.text).toBe("OVERALL: fine");
    expect(out.reason).toBeUndefined();
  });

  // A missing or rotated key used to leave a speed-run report looking normal,
  // because the skip line was rendered for the coding set only.
  test("a speed report states why the verdict is missing", async () => {
    delete process.env.NVIDIA_API_KEY;
    const outDir = join(tmpdir(), "beellama-verdict-visible");
    await mkdir(outDir, { recursive: true });
    const cfg = resolveConfig(
      parseLaunchConfig(`name: cfg\nmodel: { gguf: "D:/stub/model-UD-Q4_K_M.gguf" }\n`, "stub.yaml"),
      "C:/nonexistent/llama-server.exe",
      "stub.yaml",
      ["D:/stub"],
    );
    const row: BenchResultRow = {
      Config: "cfg", Label: "cfg", Run: 1, Type: "Code", Prompt: "p1",
      PromptTokens: 10, CompletionTokens: 20, WallTimeMs: 1000, TTFT_Ms: 100,
      TokPerSec: 50, DecodeTokPerSec: 51, FinishReason: "stop",
    };
    await writeReport(outDir, [row], [cfg], [], "standard");
    const html = await Bun.file(join(outDir, "results.html")).text();
    expect(html).toContain("Skipped: NVIDIA_API_KEY not set");
  });
});

describe("metrics delta math", () => {
  test("rate over elapsed seconds", () => {
    expect(deltaTokPerSec(1000, 1500, 5)).toBe(100);
  });
  test("zero dt yields zero", () => {
    expect(deltaTokPerSec(1000, 1500, 0)).toBe(0);
  });
  test("fetchMetrics parses stub JSON", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ prompt_tokens_total: 5, tokens_predicted_total: 7 }),
    });
    const snap = await fetchMetrics(`http://localhost:${server.port}`);
    expect(snap.tokens_predicted_total).toBe(7);
    server.stop(true);
  });

  test("fetchMetrics parses Prometheus text", async () => {
    // llama.cpp's real /metrics contract: text/plain counters, not JSON.
    const body = [
      "# HELP llamacpp:prompt_tokens_total Prompt tokens",
      "# TYPE llamacpp:prompt_tokens_total counter",
      "llamacpp:prompt_tokens_total 42",
      "llamacpp:tokens_predicted_total 128",
      "llamacpp:prompt_seconds_total 1.5",
      "llamacpp:tokens_predicted_seconds_total 3.25",
      "llamacpp:spec_decode_num_draft_tokens_total 60",
      "llamacpp:spec_decode_num_accepted_tokens_total 31",
      "llamacpp:n_decode_total 4",
    ].join("\n");
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(body, { headers: { "content-type": "text/plain; version=0.0.4" } }),
    });
    const snap = await fetchMetrics(`http://localhost:${server.port}`);
    expect(snap.prompt_tokens_total).toBe(42);
    expect(snap.tokens_predicted_total).toBe(128);
    expect(snap.tokens_predicted_seconds_total).toBe(3.25);
    expect(snap.spec_decode_num_accepted_tokens_total).toBe(31);
    expect(snap.n_decode_total).toBe(4);
    server.stop(true);
  });
});

describe("haystack expansion", () => {
  const seed = Array.from({ length: 50 }, (_, i) => `seed line ${i} padding text`).join("\n");
  const raw = [{
    name: "p1",
    type: "LongContext",
    targetChars: 5000,
    needleOffset: 0.5,
    needle: "THE-NEEDLE-VALUE",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "question?" },
    ],
  }];

  test("length reaches target and needle present once", () => {
    const [p] = expandLongCtx(raw, seed);
    const c = p.messages[1].content;
    expect(c.length).toBeGreaterThanOrEqual(5000);
    expect(c.split("THE-NEEDLE-VALUE").length - 1).toBe(1);
    expect(c.endsWith("question?")).toBe(true);
  });
  test("corpus mode fills with real code, seed mode prefixes lines", () => {
    const [a] = expandLongCtx([{ ...raw[0], name: "a" }], seed);
    const [b] = expandLongCtx([{ ...raw[0], name: "b" }], seed);
    const ca = a.messages[1].content;
    if (ca.includes("# --- ")) {
      // corpus mode: real code blocks, per-prompt deterministic shuffle
      expect(ca).toContain("# --- a block");
      expect(b.messages[1].content).not.toBe(ca);
    } else {
      // seed fallback: prefixed lines
      expect(ca.startsWith("[a p=0]")).toBe(true);
      expect(b.messages[1].content.startsWith("[b p=0]")).toBe(true);
    }
  });
});

describe("config validation errors", () => {
  test("unknown key names the file and key", () => {
    expect(() => parseLaunchConfig("name: x\nmodel: { gguf: a }\ncache_kk: q4_0\n", "configs/foo.yaml"))
      .toThrow(/configs\/foo\.yaml: cache_kk/);
  });
  test("missing name fails", () => {
    expect(() => parseLaunchConfig("model: { gguf: a }\n", "f.yaml")).toThrow(ConfigError);
  });
  test("bad number type reports yaml path", () => {
    expect(() => parseLaunchConfig("name: x\nmodel: { gguf: a }\nspec: { type: mtp, draft_max: two }\n", "f.yaml"))
      .toThrow(/spec\.draft_max must be a number/);
  });
});
