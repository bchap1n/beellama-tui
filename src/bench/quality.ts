// Quality bridge: run PSScriptAnalyzer + idiom grading via the existing
// quality_analysis.ps1 in the beellama repo. Never throws; missing module -> nulls.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appFile } from "../approot.ts";
import type { AppConfig, QualityResult } from "../types.ts";

export interface QaInput {
  prompt: string;
  content: string;
}

interface QaDriverLine {
  Prompt?: string;
  SyntaxOk?: boolean;
  PSAErrors?: number;
  PSAWarnings?: number;
  IdiomScore?: number;
  Grade?: string;
  error?: string;
}

export async function runQualityAnalysis(
  samples: QaInput[],
  appCfg: AppConfig,
): Promise<(QualityResult | undefined)[]> {
  if (samples.length === 0) return [];
  const qaPath = join(appCfg.beellama_repo, "benchmark", "quality_analysis.ps1");
  const driverPath = appFile("scripts", "qa-driver.ps1");
  const out: (QualityResult | undefined)[] = samples.map(() => undefined);
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "beellama-qa-"));
    const inPath = join(dir, "input.json");
    await writeFile(inPath, JSON.stringify(samples));
    const proc = Bun.spawn(
      ["pwsh", "-NoProfile", "-File", driverPath, "-QaPath", qaPath, "-InputFile", inPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    let qi = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row: QaDriverLine;
      try {
        row = JSON.parse(line) as QaDriverLine;
      } catch {
        continue;
      }
      // Driver emits one line per sample in input order; skip its own error
      // lines (they carry no SyntaxOk field).
      if (row.error !== undefined || row.SyntaxOk === undefined) continue;
      const idx = qi < samples.length ? qi : -1;
      qi++;
      if (idx < 0) continue;
      out[idx] = {
        syntaxOk: row.SyntaxOk ?? false,
        psaErrors: row.PSAErrors ?? 0,
        psaWarnings: row.PSAWarnings ?? 0,
        idiomScore: row.IdiomScore ?? -1,
        grade: row.Grade ?? "F",
      };
    }
  } catch {
    // bridge unavailable — QA columns stay empty
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return out;
}
