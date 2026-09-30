// CLI entry: default TUI, --list, doctor, bench.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadAppConfig } from "./config.ts";
import { appFile } from "./approot.ts";
import { deriveFacets, loadLaunchConfigs, parseLaunchConfig } from "./launch-config.ts";
import { resolveBinary } from "./binary.ts";
import type { AppConfig, LaunchConfig } from "./types.ts";
import { runBenchmark } from "./bench/runner.ts";
import { runTui } from "./tui/App.tsx";

export async function loadAll(appCfg: AppConfig): Promise<{ configs: LaunchConfig[]; errors: string[] }> {
  const dir = appFile(appCfg.configs_dir);
  const configs: LaunchConfig[] = [];
  const errors: string[] = [];
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".yaml") || n.endsWith(".yml")).sort();
  } catch {
    return { configs, errors: [`configs dir not found: ${dir}`] };
  }
  for (const n of names) {
    const file = join(dir, n);
    try {
      configs.push(parseLaunchConfig(await Bun.file(file).text(), file));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { configs, errors };
}

async function listCmd(): Promise<number> {
  const appCfg = await loadAppConfig();
  const { configs, errors } = await loadAll(appCfg);
  for (const e of errors) console.error(`✗ ${e}`);
  if (configs.length === 0 && errors.length === 0) {
    console.log(`No configs found in ${appFile(appCfg.configs_dir)}`);
    return 1;
  }
  const header = ["NAME", "MODEL", "QUANT", "CTX", "PROVIDER", "SPEC", "THINK", "VISION", "Q", "TAGS"];
  const rows = configs.map((c) => {
    const f = deriveFacets(c, appCfg.model_roots);
    return [
      c.name,
      f.model,
      f.quant,
      String(f.ctx),
      f.provider,
      f.spec,
      f.think ? "on" : "off",
      f.vision ? "y" : "-",
      f.quality ? "*" : "-",
      c.tags.join(","),
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmt(header));
  for (const r of rows) console.log(fmt(r));
  return errors.length > 0 ? 1 : 0;
}

interface DoctorEntry {
  name: string;
  ok: boolean;
  detail: string;
}

async function doctorCmd(): Promise<number> {
  const appCfg = await loadAppConfig();
  const { configs, errors } = await loadAll(appCfg);
  const entries: DoctorEntry[] = [];
  for (const e of errors) entries.push({ name: "(parse)", ok: false, detail: e });

  const seen = new Set<string>();
  for (const c of configs) {
    if (seen.has(c.name)) {
      entries.push({ name: c.name, ok: false, detail: `duplicate name` });
      continue;
    }
    seen.add(c.name);
    const problems: string[] = [];
    try {
      resolveBinary(c.build, appCfg);
    } catch (e) {
      problems.push(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
    for (const [label, p] of [
      ["gguf", c.model.gguf],
      ["mmproj", c.model.mmproj],
      ["draft", c.draft?.gguf],
    ] as const) {
      if (!p) continue;
      try {
        if (!(await Bun.file(p).exists())) problems.push(`${label} missing: ${p}`);
      } catch {
        problems.push(`${label} unreadable: ${p}`);
      }
    }
    entries.push({ name: c.name, ok: problems.length === 0, detail: problems.join("; ") || "ok" });
  }

  let fail = 0;
  for (const e of entries) {
    if (!e.ok) fail++;
    console.log(`${e.ok ? "✓" : "✗"} ${e.name}${e.ok ? "" : ": " + e.detail}`);
  }
  console.log(`\n${entries.length - fail}/${entries.length} ok`);
  return fail > 0 ? 1 : 0;
}

export interface BenchCliOpts {
  config?: string;
  set?: string;
  runs?: number;
  out?: string;
  url?: string;
  help?: boolean;
}

function parseBenchArgs(argv: string[]): BenchCliOpts {
  const opts: BenchCliOpts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") opts.config = argv[++i];
    else if (a === "--set") opts.set = argv[++i];
    else if (a === "--runs") opts.runs = Number(argv[++i]);
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--url") opts.url = argv[++i];
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

async function benchCmd(argv: string[]): Promise<number> {
  const opts = parseBenchArgs(argv);
  if (opts.help || !opts.config) {
    console.log("Usage: beellama-tui bench --config <name> [--set standard|coding|longctx|all] [--runs N] [--out dir] [--url base-url]");
    return opts.help ? 0 : 1;
  }
  return runBenchmark(opts);
}

const HELP = `beellama-tui — llama-server launcher TUI

Usage:
  beellama-tui              launch the TUI
  beellama-tui --list       print config table
  beellama-tui doctor       validate all configs
  beellama-tui bench ...    headless benchmark
  beellama-tui help         this text`;

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (cmd === "--list" || cmd === "list") return listCmd();
  if (cmd === "doctor") return doctorCmd();
  if (cmd === "bench") return benchCmd(argv.slice(1));
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return 0;
  }
  await runTui();
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    // A thrown config/env error prints its message, not a stack trace.
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
