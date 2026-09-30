// App-level config: beellama-tui.yaml from repo root (cwd fallback).
import { parse as parseYaml } from "yaml";
import { join } from "node:path";
import type { AppConfig } from "./types.ts";
import { appFile, expandVars } from "./approot.ts";

const DEFAULTS: AppConfig = {
  beellama_repo: process.env.BEELLAMA_REPO ?? "",
  // One env var holds every root: BEELLAMA_MODEL_ROOTS="D:/models;C:/models".
  model_roots: (process.env.BEELLAMA_MODEL_ROOTS ?? "").split(";").filter(Boolean),
  server: { host: "127.0.0.1", port: 8082 },
  configs_dir: "configs",
  gpu_power_limit_watts: 280,
  gpu_clock_mhz: 0,
  benchmark: {
    runs: 3,
    max_tokens: 2048,
    warmup_runs: 3,
    warmup_tokens: 256,
    cooldown_sec: 0,
    config_cooldown_sec: 60,
    retries: 2,
    timeout_sec: 180,
  },
};

export async function loadAppConfig(cwd = process.cwd()): Promise<AppConfig> {
  const candidates = [
    join(cwd, "beellama-tui.yaml"),
    appFile("beellama-tui.yaml"),
  ];
  for (const p of candidates) {
    const f = Bun.file(p);
    if (await f.exists()) {
      return mergeDefaults(parseYaml(await f.text()));
    }
  }
  return { ...DEFAULTS };
}

function mergeDefaults(raw: unknown): AppConfig {
  const r = (raw ?? {}) as Partial<AppConfig>;
  const cfg: AppConfig = {
    ...DEFAULTS,
    ...r,
    server: { ...DEFAULTS.server, ...(r.server ?? {}) },
    benchmark: { ...DEFAULTS.benchmark, ...(r.benchmark ?? {}) },
  };
  cfg.beellama_repo = expandVars(cfg.beellama_repo, "beellama-tui.yaml beellama_repo");
  // yaml allows a string here so one ${VAR} can carry several roots — expand
  // first, then split ("${VAR}" alone would split wrongly before expansion).
  const rootsRaw = typeof cfg.model_roots === "string" ? (cfg.model_roots as unknown as string) : (cfg.model_roots ?? []).join(";");
  cfg.model_roots = expandVars(rootsRaw, "beellama-tui.yaml model_roots").split(";").filter(Boolean);
  if (cfg.binaries) {
    for (const [k, v] of Object.entries(cfg.binaries)) cfg.binaries[k] = expandVars(v, `beellama-tui.yaml binaries.${k}`);
  }
  return cfg;
}
