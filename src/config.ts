// App-level config: beellama-tui.yaml from repo root (cwd fallback).
import { parse as parseYaml } from "yaml";
import { join } from "node:path";
import type { AppConfig } from "./types.ts";

const DEFAULTS: AppConfig = {
  beellama_repo: "C:/Users/brock/Documents/github/beellama",
  model_roots: ["D:/.lmstudio/models", "C:/Users/brock/.lmstudio/models"],
  server: { host: "127.0.0.1", port: 8082 },
  configs_dir: "configs",
  gpu_power_limit_watts: 250,
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
    join(import.meta.dir, "..", "beellama-tui.yaml"),
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
  return {
    ...DEFAULTS,
    ...r,
    server: { ...DEFAULTS.server, ...(r.server ?? {}) },
    benchmark: { ...DEFAULTS.benchmark, ...(r.benchmark ?? {}) },
  };
}
