// Report generation: legacy-header CSV, single-file neon HTML, DeepSeek verdict.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BenchResultRow } from "../types.ts";
import { appFile } from "../approot.ts";
import { median } from "./runner.ts";
import { beeHtml } from "../bee.tsx";

// Byte-for-byte legacy header from run_benchmark.ps1 results.csv.
export const CSV_HEADER =
  "Config,Label,Run,Prompt,Type,PromptTokens,CompletionTokens,WallTimeMs,TTFT_Ms,TokPerSec,DecodeTokPerSec,QASyntaxOk,QAPSAErrors,QAPSAWarnings,QAIdiomScore,QAGrade";

function csvEscape(v: string | number | boolean | undefined): string {
  if (v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function rowsToCsv(rows: BenchResultRow[]): string {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push(
      [
        r.Config, r.Label, r.Run, r.Prompt, r.Type,
        r.PromptTokens, r.CompletionTokens, r.WallTimeMs, r.TTFT_Ms,
        r.TokPerSec, r.DecodeTokPerSec,
        r.QASyntaxOk ?? "", r.QAPSAErrors ?? "", r.QAPSAWarnings ?? "",
        r.QAIdiomScore ?? "", r.QAGrade ?? "",
      ].map(csvEscape).join(","),
    );
  }
  return lines.join("\n") + "\n";
}

interface AnalysisPrompts {
  system: string;
  template_single?: string;
  template_compare?: string;
}

export async function deepSeekVerdict(
  dataText: string,
  configCount: number,
  promptsDir: string,
): Promise<string | undefined> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return undefined;
  try {
    const ana = JSON.parse(await Bun.file(join(promptsDir, "prompts-analysis.json")).text()) as AnalysisPrompts;
    const isCompare = configCount > 1;
    const template = isCompare ? ana.template_compare : ana.template_single;
    if (!template) return undefined;
    const extra = isCompare ? "6) Which model wins for coding quality and why." : "";
    const body = template
      .replaceAll("{0}", dataText)
      .replaceAll("{1}", extra)
      .replaceAll("{2}", String(configCount));
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: ana.system },
          { role: "user", content: body },
        ],
        max_tokens: 2500,
        temperature: 0.2,
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
    const msg = json.choices?.[0]?.message;
    const verdict = (msg?.content || msg?.reasoning_content || "").trim();
    return verdict.length > 0 ? verdict : undefined;
  } catch {
    return undefined;
  }
}

// Deterministic quality score: fixed weights over bridge QA columns, no LLM variance.
// Doctrine matches the legacy harness: syntax and PSA dominate, idiom is a capped bonus.
export function tldrScore(rows: BenchResultRow[]): { score: number; gradeMode: string; avgPsaE: number; avgPsaW: number } | undefined {
  // Only meaningful when QA columns exist (coding set); otherwise fake scores would render.
  if (rows.length === 0 || !rows.some((r) => r.QASyntaxOk !== undefined || r.QAGrade !== undefined)) return undefined;
  const n = rows.length;
  const synFail = rows.filter((r) => r.QASyntaxOk === false).length / n;
  const avgPsaE = rows.reduce((a, r) => a + (r.QAPSAErrors ?? 0), 0) / n;
  const avgPsaW = rows.reduce((a, r) => a + (r.QAPSAWarnings ?? 0), 0) / n;
  const idioms = rows.map((r) => r.QAIdiomScore).filter((v): v is number => v !== undefined && v >= 0);
  const avgIdiom = idioms.length > 0 ? idioms.reduce((a, b) => a + b, 0) / idioms.length : 0;
  let score = 10
    - 4 * synFail          // syntax failure is fatal-ish: -4 at 100% failure
    - 0.6 * avgPsaE
    - 0.2 * avgPsaW
    + Math.max(0, Math.min(0.5, (avgIdiom - 70) / 30)); // pure bonus: 0 below 70%, +0.5 max above
  score = Math.max(0, Math.min(10, score));
  const gradeCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.QAGrade) gradeCounts.set(r.QAGrade, (gradeCounts.get(r.QAGrade) ?? 0) + 1);
  }
  const gradeMode = [...gradeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
  return { score: Number(score.toFixed(1)), gradeMode, avgPsaE: Number(avgPsaE.toFixed(1)), avgPsaW: Number(avgPsaW.toFixed(1)) };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function writeReport(
  outDir: string,
  rows: BenchResultRow[],
  configs: string[],
  failures: string[],
  setName: string,
): Promise<void> {
  await writeFile(join(outDir, "results.csv"), rowsToCsv(rows));

  // Per-config summary cards
  const byConfig = new Map<string, BenchResultRow[]>();
  for (const r of rows) {
    const list = byConfig.get(r.Config) ?? [];
    list.push(r);
    byConfig.set(r.Config, list);
  }

  // TLDR: deterministic per-config scores, stable across runs.
  const tldrRows = configs
    .map((c) => ({ cfg: c, tok: median((byConfig.get(c) ?? []).map((r) => r.TokPerSec)), s: tldrScore(byConfig.get(c) ?? []) }))
    .filter((e) => e.s !== undefined);
  let tldrHtml = "";
  if (tldrRows.length > 0) {
    const ranked = [...tldrRows].sort((a, b) => b.s!.score - a.s!.score);
    const winner = ranked[0];
    tldrHtml = "<div class='section'>TLDR — deterministic score (fixed rubric, no LLM)</div><table class='tldr'>" +
      "<tr><th>config</th><th>score</th><th>grade mode</th><th>PSA err/warn avg</th><th>tok/s</th></tr>" +
      ranked.map((e) =>
        `<tr${e.cfg === winner.cfg ? " class='winner'" : ""}><th>${esc(e.cfg)}</th><td><b>${e.s!.score.toFixed(1)}</b>/10</td><td>${esc(e.s!.gradeMode)}</td><td>${e.s!.avgPsaE}/${e.s!.avgPsaW}</td><td>${e.tok.toFixed(1)}</td></tr>`,
      ).join("") +
      "</table>";
  }
  let cardsHtml = "";
  for (const cfg of configs) {
    const list = byConfig.get(cfg) ?? [];
    if (list.length === 0) continue;
    const tok = median(list.map((r) => r.TokPerSec));
    const dec = median(list.map((r) => r.DecodeTokPerSec));
    const ttft = median(list.map((r) => r.TTFT_Ms));
    cardsHtml += `<div class="card"><div class="cfg">${esc(cfg)}</div>
      <div class="stat"><span class="v">${tok.toFixed(1)}</span><span class="k">tok/s</span></div>
      <div class="stat"><span class="v">${dec.toFixed(1)}</span><span class="k">decode</span></div>
      <div class="stat"><span class="v">${ttft.toFixed(0)}</span><span class="k">ttft ms</span></div></div>`;
  }

  // Per-prompt comparison table
  const promptNames = [...new Set(rows.map((r) => r.Prompt))];
  let tableRows = "";
  for (const pn of promptNames) {
    const cells = configs.map((c) => {
      const rs = rows.filter((r) => r.Config === c && r.Prompt === pn);
      if (rs.length === 0) return "<td class='dim'>-</td>";
      const m = median(rs.map((r) => r.TokPerSec));
      return `<td>${m.toFixed(1)}</td>`;
    });
    tableRows += `<tr><th>${esc(pn)}</th>${cells.join("")}</tr>`;
  }

  // Grade distribution (quality mode)
  let gradeHtml = "";
  const graded = rows.filter((r) => r.QAGrade);
  if (graded.length > 0) {
    const grades = ["A", "B+", "B", "C", "D", "F"];
    gradeHtml = "<div class='section'>grade distribution</div><table><tr><th>config</th>" +
      grades.map((g) => `<th>${g}</th>`).join("") + "</tr>";
    for (const cfg of configs) {
      const counts = grades.map((g) => graded.filter((r) => r.Config === cfg && r.QAGrade === g).length);
      gradeHtml += `<tr><th>${esc(cfg)}</th>` + counts.map((n) => `<td>${n || "-"}</td>`).join("") + "</tr>";
    }
    gradeHtml += "</table>";
  }

  // All results collapsible
  let allHtml = "";
  if (rows.length > 0) {
    const cols = ["Config", "Run", "Prompt", "PromptTokens", "CompletionTokens", "WallTimeMs", "TTFT_Ms", "TokPerSec", "DecodeTokPerSec", "QAGrade"];
    allHtml = "<details><summary>all results</summary><table><tr>" +
      cols.map((c) => `<th>${c}</th>`).join("") + "</tr>" +
      rows.map((r) => "<tr>" + cols.map((c) => `<td>${esc(String((r as unknown as Record<string, unknown>)[c] ?? ""))}</td>`).join("") + "</tr>").join("") +
      "</table></details>";
  }

  // DeepSeek verdict
  let analysisHtml = "";
  const dataLines: string[] = [];
  for (const cfg of configs) {
    const list = byConfig.get(cfg) ?? [];
    if (list.length === 0) continue;
    const tok = median(list.map((r) => r.TokPerSec));
    const ttft = median(list.map((r) => r.TTFT_Ms));
    const s = tldrRows.find((e) => e.cfg === cfg)?.s;
    dataLines.push(`CONFIG: ${cfg} | TLDR score ${s ? s.score.toFixed(1) + "/10" : "n/a"} grade mode ${s?.gradeMode ?? "-"} | ${tok.toFixed(1)} tok/s median TTFT ${ttft.toFixed(0)}ms | PSA err/warn avg ${s ? `${s.avgPsaE}/${s.avgPsaW}` : "n/a"}`);
    for (const pn of promptNames) {
      const rs = list.filter((r) => r.Prompt === pn);
      if (rs.length === 0) continue;
      const m = median(rs.map((r) => r.TokPerSec));
      const g = rs.find((r) => r.QAGrade)?.QAGrade ?? "";
      dataLines.push(`  - ${pn}: ${m.toFixed(1)} tok/s ${g ? `grade ${g}` : ""}`);
    }
  }
  const verdict = await deepSeekVerdict(dataLines.join("\n"), configs.length, appFile("prompts"));
  if (verdict) {
    analysisHtml = `<div class='section'>deepseek analysis // deepseek-v4-flash</div><div class='analysis-text'>${esc(verdict).replace(/\n/g, "<br>")}</div>`;
  } else if (setName === "coding") {
    analysisHtml = "<div class='section'>deepseek analysis</div><p class='dim'>Skipped: DEEPSEEK_API_KEY not set.</p>";
  }

  const failHtml = failures.length > 0
    ? `<div class='section'>failures</div><pre class='dim'>${esc(failures.join("\n"))}</pre>`
    : "";

  const bee = beeHtml();
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>beellama-tui benchmark</title>
<style>
  body { background:#0a0f0a; color:#39ff6a; font-family:'JetBrains Mono',monospace; margin:24px; }
  h1 { color:#7dff9e; font-weight:600; letter-spacing:1px; }
  .cards { display:flex; gap:16px; flex-wrap:wrap; margin:16px 0; }
  .card { border:1px solid #1e5c31; padding:12px 18px; min-width:180px; background:#0d140d; }
  .cfg { color:#a0ffa8; margin-bottom:8px; font-size:13px; }
  .stat { display:flex; justify-content:space-between; gap:12px; }
  .stat .v { font-size:20px; color:#39ff6a; }
  .stat .k { color:#3f7a4e; font-size:11px; align-self:center; }
  table { border-collapse:collapse; margin:12px 0; }
  th, td { border:1px solid #1e5c31; padding:4px 10px; text-align:right; font-size:13px; }
  th:first-child, td:first-child { text-align:left; }
  .tldr td b { color:#7dff9e; font-size:15px; }
  .tldr .winner th, .tldr .winner td { background:#12240f; }
  .section { color:#7dff9e; margin-top:28px; border-bottom:1px solid #1e5c31; padding-bottom:4px; }
  .dim { color:#3f7a4e; }
  .analysis-text { line-height:1.5; white-space:normal; }
  summary { cursor:pointer; color:#7dff9e; margin-top:20px; }
${bee.css}
  .head { overflow:hidden; margin-bottom:8px; }
  h1 { margin-top:0; }
</style></head><body>
<div class="head">${bee.html}<h1>beellama-tui benchmark — ${esc(setName)} — ${new Date().toISOString()}</h1></div>
${tldrHtml}
<div class="cards">${cardsHtml}</div>
<div class="section">per-prompt median tok/s</div>
<table><tr><th>prompt</th>${configs.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${tableRows}</table>
${gradeHtml}${allHtml}${analysisHtml}${failHtml}
</body></html>`;

  await writeFile(join(outDir, "results.html"), html);
}
