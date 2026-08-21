// Binary resolution: app config override -> beellama run/config.json -> lucebox special case.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./types.ts";

export function resolveBinary(buildKey: string, appCfg: AppConfig): string {
  const tried: string[] = [];

  const override = appCfg.binaries?.[buildKey];
  if (override) {
    if (existsSync(override)) return override;
    tried.push(override);
  }

  const repoCfg = join(appCfg.beellama_repo, "run", "config.json");
  let binaries: Record<string, string> | undefined;
  try {
    const parsed = JSON.parse(readFileSync(repoCfg, "utf8")) as { binaries?: Record<string, string> };
    binaries = parsed.binaries;
  } catch {
    // missing or invalid run/config.json — skip
  }
  const rel = binaries?.[buildKey];
  if (rel) {
    const full = join(appCfg.beellama_repo, rel);
    if (existsSync(full)) return full;
    tried.push(full);
  }

  if (buildKey === "lucebox") {
    const lucebox = join(appCfg.beellama_repo, "sources", "lucebox-hub", "server", "build", "dflash_server.exe");
    if (existsSync(lucebox)) return lucebox;
    tried.push(lucebox);
  }

  throw new Error(`Build '${buildKey}' not found. Tried:\n  ${tried.join("\n  ") || "(no candidates)"}`);
}
