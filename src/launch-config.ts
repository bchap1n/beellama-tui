// Launch-config parsing, validation, facet derivation, and server arg building.
// Flag style mirrors run/*.ps1 in the beellama repo (see beellama_common.ps1).
import { parse as parseYaml } from "yaml";
import { basename, isAbsolute, join, relative } from "node:path";
import { readdir } from "node:fs/promises";
import type { Facets, LaunchConfig, ResolvedConfig, SpecFacet } from "./types.ts";

// Legacy quant regex from start-beellama.ps1 line 184, extended with Q4_0/Q8_0-style drafts.
const QUANT_RE =
  /(AD-Q\d+_K-Q\d+_K|UD-Q\d+_K_[A-Z]+|AD-Q\d+_K|IQ\d+_[A-Z]+|Q\d+_K_[A-Z]+|Q\d+_K|BF16|F32|F16|none|Q\d_\d|IQ\d_\w+)/;

const TOP_KEYS = new Set([
  "name", "label", "description", "tags", "build", "model", "draft", "spec",
  "ctx_size", "batch", "ubatch", "cache_k", "cache_v", "kv_tail_tokens",
  "kv_unified", "ngl", "flash_attn", "no_mmap", "mlock", "reasoning",
  "reasoning_effort", "sampling", "extra_args", "port", "env",
]);
const MODEL_KEYS = new Set(["gguf", "provider", "mmproj"]);
const SPEC_KEYS = new Set(["type", "draft_max", "cross_ctx"]);
const SAMPLING_KEYS = new Set(["temp", "top_p", "top_k", "min_p", "presence_penalty", "repeat_penalty"]);

export const DEFAULT_CTX_SIZE = 131072;
export const DEFAULT_BATCH = 2048;
export const DEFAULT_UBATCH = 256;
export const DEFAULT_CACHE = "turbo4";

export class ConfigError extends Error {}

function err(file: string, path: string, msg: string): never {
  throw new ConfigError(`${file}: ${path} ${msg}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, file: string, path: string): string {
  if (typeof v !== "string" || v.length === 0) err(file, path, "must be a non-empty string");
  return v;
}

function asNumber(v: unknown, file: string, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) err(file, path, "must be a number");
  return v;
}

function asBool(v: unknown, file: string, path: string): boolean {
  if (typeof v !== "boolean") err(file, path, "must be a boolean");
  return v;
}

function checkKeys(obj: Record<string, unknown>, allowed: Set<string>, file: string, prefix: string): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) err(file, prefix + k, "is not a known key");
  }
}

export function parseLaunchConfig(text: string, file: string): LaunchConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError(`${file}: invalid YAML (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!isRecord(raw)) err(file, "", "must be a YAML mapping");

  checkKeys(raw, TOP_KEYS, file, "");
  const name = asString(raw.name, file, "name");
  if (!isRecord(raw.model)) err(file, "model", "must be a mapping");
  const modelRaw = raw.model;
  checkKeys(modelRaw, MODEL_KEYS, file, "model.");
  const gguf = asString(modelRaw.gguf, file, "model.gguf");

  const cfg: LaunchConfig = {
    name,
    tags: [],
    build: "beellama",
    model: { gguf },
    extra_args: [],
    port: 0,
    env: {},
    reasoning: false,
    flash_attn: true,
    kv_unified: true,
    ngl: "all",
  };

  if (raw.label !== undefined) cfg.label = asString(raw.label, file, "label");
  if (raw.description !== undefined) cfg.description = asString(raw.description, file, "description");
  if (raw.build !== undefined) cfg.build = asString(raw.build, file, "build");
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((t) => typeof t === "string"))
      err(file, "tags", "must be a list of strings");
  }
  if (modelRaw.provider !== undefined) cfg.model.provider = asString(modelRaw.provider, file, "model.provider");
  if (modelRaw.mmproj !== undefined) cfg.model.mmproj = asString(modelRaw.mmproj, file, "model.mmproj");

  if (raw.draft !== undefined) {
    if (!isRecord(raw.draft)) err(file, "draft", "must be a mapping");
    checkKeys(raw.draft, new Set(["gguf"]), file, "draft.");
    cfg.draft = { gguf: asString(raw.draft.gguf, file, "draft.gguf") };
  }

  if (raw.spec !== undefined) {
    if (!isRecord(raw.spec)) err(file, "spec", "must be a mapping");
    checkKeys(raw.spec, SPEC_KEYS, file, "spec.");
    const type = asString(raw.spec.type, file, "spec.type");
    const spec: LaunchConfig["spec"] = { type };
    if (raw.spec.draft_max !== undefined) spec.draft_max = asNumber(raw.spec.draft_max, file, "spec.draft_max");
    if (raw.spec.cross_ctx !== undefined) spec.cross_ctx = asNumber(raw.spec.cross_ctx, file, "spec.cross_ctx");
    cfg.spec = spec;
  }

  if (raw.ctx_size !== undefined) cfg.ctx_size = asNumber(raw.ctx_size, file, "ctx_size");
  if (raw.batch !== undefined) cfg.batch = asNumber(raw.batch, file, "batch");
  if (raw.ubatch !== undefined) cfg.ubatch = asNumber(raw.ubatch, file, "ubatch");
  if (raw.cache_k !== undefined) cfg.cache_k = asString(raw.cache_k, file, "cache_k");
  if (raw.cache_v !== undefined) cfg.cache_v = asString(raw.cache_v, file, "cache_v");
  if (raw.kv_tail_tokens !== undefined) cfg.kv_tail_tokens = asNumber(raw.kv_tail_tokens, file, "kv_tail_tokens");
  if (raw.kv_unified !== undefined) cfg.kv_unified = asBool(raw.kv_unified, file, "kv_unified");
  if (raw.ngl !== undefined) {
    if (raw.ngl === "all") cfg.ngl = "all";
    else cfg.ngl = asNumber(raw.ngl, file, "ngl");
  }
  if (raw.flash_attn !== undefined) cfg.flash_attn = asBool(raw.flash_attn, file, "flash_attn");
  if (raw.no_mmap !== undefined) cfg.no_mmap = asBool(raw.no_mmap, file, "no_mmap");
  if (raw.mlock !== undefined) cfg.mlock = asBool(raw.mlock, file, "mlock");
  if (raw.reasoning !== undefined) cfg.reasoning = asBool(raw.reasoning, file, "reasoning");
  if (raw.reasoning_effort !== undefined)
    cfg.reasoning_effort = asString(raw.reasoning_effort, file, "reasoning_effort");

  if (raw.sampling !== undefined) {
    if (!isRecord(raw.sampling)) err(file, "sampling", "must be a mapping");
    checkKeys(raw.sampling, SAMPLING_KEYS, file, "sampling.");
    cfg.sampling = {};
    for (const k of ["temp", "top_p", "top_k", "min_p", "presence_penalty", "repeat_penalty"] as const) {
      if (raw.sampling[k] !== undefined) cfg.sampling[k] = asNumber(raw.sampling[k], file, `sampling.${k}`);
    }
  }

  if (raw.extra_args !== undefined) {
    if (!Array.isArray(raw.extra_args) || !raw.extra_args.every((a) => typeof a === "string"))
      err(file, "extra_args", "must be a list of strings");
    cfg.extra_args = raw.extra_args;
  }
  if (raw.port !== undefined) cfg.port = asNumber(raw.port, file, "port");
  if (raw.env !== undefined) {
    if (!isRecord(raw.env)) err(file, "env", "must be a mapping of strings");
    for (const [k, v] of Object.entries(raw.env)) {
      if (typeof v !== "string") err(file, `env.${k}`, "must be a string");
      cfg.env[k] = v;
    }
  }

  return cfg;
}

export async function loadLaunchConfigs(dir: string): Promise<LaunchConfig[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".yaml") || n.endsWith(".yml")).sort();
  } catch {
    return [];
  }
  const seen = new Map<string, string>();
  const out: LaunchConfig[] = [];
  for (const n of names) {
    const file = join(dir, n);
    const cfg = parseLaunchConfig(await Bun.file(file).text(), file);
    if (seen.has(cfg.name)) throw new ConfigError(`${file}: duplicate config name '${cfg.name}' (also in ${seen.get(cfg.name)})`);
    seen.set(cfg.name, file);
    out.push(cfg);
  }
  return out;
}

export function quantOf(stem: string): { quant: string; model: string } {
  const m = QUANT_RE.exec(stem);
  if (!m) return { quant: "unknown", model: stem };
  const quant = m[1];
  const model = stem.slice(0, m.index).replace(/[-_.\s]+$/, "") || stem;
  return { quant, model };
}

// First path segment of gguf relative to any configured model root; explicit override wins.
export function providerOf(ggufPath: string, modelRoots: string[], override?: string): string {
  if (override) return override;
  const norm = ggufPath.replaceAll("\\", "/");
  for (const root of modelRoots) {
    const r = root.replaceAll("\\", "/").replace(/\/+$/, "");
    if (norm.toLowerCase().startsWith(r.toLowerCase() + "/")) {
      const rel = relative(r, norm).replaceAll("\\", "/");
      const first = rel.split("/")[0];
      if (first) return first;
    }
  }
  return "unknown";
}

// Which configured root (source) a gguf lives under, if any.
export function rootOf(ggufPath: string, modelRoots: string[]): string | undefined {
  const norm = ggufPath.replaceAll("\\", "/");
  for (const root of modelRoots) {
    const r = root.replaceAll("\\", "/").replace(/\/+$/, "");
    if (norm.toLowerCase().startsWith(r.toLowerCase() + "/")) return r;
  }
  return undefined;
}

export function specFacetOf(cfg: LaunchConfig): SpecFacet {
  const t = cfg.spec?.type;
  if (!t || t === "none") return "none";
  if (t === "draft-mtp" || t === "mtp") return "mtp";
  if (t === "draft-dflash" || t === "dflash") return "dflash";
  if (t === "draft-dspark" || t === "dspark") return "dspark";
  return "other";
}

export function deriveFacets(cfg: LaunchConfig, modelRoots: string[]): Facets {
  const stem = basename(cfg.model.gguf).replace(/\.gguf$/i, "");
  const { quant, model } = quantOf(stem);
  return {
    provider: providerOf(cfg.model.gguf, modelRoots, cfg.model.provider),
    quant,
    model,
    ctx: cfg.ctx_size ?? DEFAULT_CTX_SIZE,
    think: cfg.reasoning,
    vision: cfg.model.mmproj !== undefined,
    quality: cfg.tags.includes("quality"),
    spec: specFacetOf(cfg),
  };
}

export function resolveConfig(cfg: LaunchConfig, binaryPath: string, file: string, modelRoots: string[]): ResolvedConfig {
  return { ...cfg, file, binaryPath, facets: deriveFacets(cfg, modelRoots) };
}

// Build llama-server args in the exact style of the migrated run/*.ps1 scripts.
export function buildArgs(cfg: LaunchConfig, host: string, port: number): string[] {
  const args: string[] = ["-m", cfg.model.gguf];

  if (cfg.model.mmproj) {
    args.push("--mmproj", cfg.model.mmproj, "--no-mmproj-offload");
  }

  const specType = cfg.spec?.type;
  if (specType && specType !== "none") {
    if (cfg.draft?.gguf) args.push("--spec-draft-model", cfg.draft.gguf);
    args.push("--spec-type", specType);
    if (cfg.spec?.draft_max !== undefined) args.push("--spec-draft-n-max", String(cfg.spec.draft_max));
    if (specType === "draft-dflash" || specType === "draft-dspark") args.push("--spec-draft-ngl", "all");
    if (cfg.spec?.cross_ctx !== undefined) args.push("--spec-dflash-cross-ctx", String(cfg.spec.cross_ctx));
  }

  args.push("--port", String(cfg.port || port), "--host", host);
  args.push("-np", "1");
  if (cfg.kv_unified !== false) args.push("--kv-unified");
  args.push("-ngl", String(cfg.ngl));
  args.push("--ctx-size", String(cfg.ctx_size ?? DEFAULT_CTX_SIZE));
  args.push("-b", String(cfg.batch ?? DEFAULT_BATCH), "-ub", String(cfg.ubatch ?? DEFAULT_UBATCH));
  args.push("--cache-type-k", cfg.cache_k ?? DEFAULT_CACHE, "--cache-type-v", cfg.cache_v ?? DEFAULT_CACHE);
  if (cfg.kv_tail_tokens !== undefined) args.push("--kv-tail-tokens", String(cfg.kv_tail_tokens));
  if (cfg.flash_attn !== false) args.push("--flash-attn", "on");
  args.push("--jinja");
  if (cfg.no_mmap) args.push("--no-mmap");
  if (cfg.mlock) args.push("--load-mode", "mlock");
  args.push("--no-host", "--metrics", "--log-colors", "off");

  args.push("--reasoning", cfg.reasoning ? "on" : "off");
  const kwargs: Record<string, unknown> = { preserve_thinking: cfg.reasoning };
  if (cfg.reasoning_effort) kwargs.reasoning_effort = cfg.reasoning_effort;
  args.push("--chat-template-kwargs", JSON.stringify(kwargs));

  const s = cfg.sampling;
  if (s) {
    if (s.temp !== undefined) args.push("--temp", String(s.temp));
    if (s.top_p !== undefined) args.push("--top-p", String(s.top_p));
    if (s.top_k !== undefined) args.push("--top-k", String(s.top_k));
    if (s.min_p !== undefined) args.push("--min-p", String(s.min_p));
    if (s.presence_penalty !== undefined) args.push("--presence-penalty", String(s.presence_penalty));
    if (s.repeat_penalty !== undefined) args.push("--repeat-penalty", String(s.repeat_penalty));
  }

  args.push(...cfg.extra_args);
  return args;
}
