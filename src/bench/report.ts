// Report generation: legacy-header CSV, single-file neon HTML, DeepSeek verdict.
import { writeFile } from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import type { BenchResultRow, ResolvedConfig } from "../types.ts";
import { appFile } from "../approot.ts";
import { median } from "./runner.ts";

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
  configs: ResolvedConfig[],
  failures: string[],
  setName: string,
): Promise<void> {
  await writeFile(join(outDir, "results.csv"), rowsToCsv(rows));

  const byConfig = new Map<string, BenchResultRow[]>();
  for (const r of rows) {
    const list = byConfig.get(r.Config) ?? [];
    list.push(r);
    byConfig.set(r.Config, list);
  }

  // TLDR: deterministic per-config scores, stable across runs.
  const tldrRows = configs
    .map((c) => ({ cfg: c.name, tok: median((byConfig.get(c.name) ?? []).map((r) => r.TokPerSec)), s: tldrScore(byConfig.get(c.name) ?? []) }))
    .filter((e) => e.s !== undefined);
  let tldrHtml = "";
  if (tldrRows.length > 0) {
    const ranked = [...tldrRows].sort((a, b) => b.s!.score - a.s!.score);
    const winner = ranked[0];
    tldrHtml = "<div class='sec'>TLDR · deterministic score</div><table class='tldr'>" +
      "<tr><th>config</th><th>score</th><th>grade</th><th>psa e/w</th><th>tok/s</th></tr>" +
      ranked.map((e) =>
        `<tr${e.cfg === winner.cfg ? " class='winner'" : ""}><td>${esc(e.cfg)}</td><td><b>${e.s!.score.toFixed(1)}</b></td><td>${esc(e.s!.gradeMode)}</td><td>${e.s!.avgPsaE}/${e.s!.avgPsaW}</td><td>${e.tok.toFixed(1)}</td></tr>`,
      ).join("") +
      "</table>";
  }

  // Per-config stat cards with full identity.
  let cardsHtml = "";
  configs.forEach((cfg, i) => {
    const list = byConfig.get(cfg.name) ?? [];
    if (list.length === 0) return;
    const tok = median(list.map((r) => r.TokPerSec));
    const dec = median(list.map((r) => r.DecodeTokPerSec));
    const ttft = median(list.map((r) => r.TTFT_Ms));
    const f = cfg.facets;
    cardsHtml += `<div class="card"><div class="cfg"><span class="idx">${i + 1}</span>${esc(cfg.name)}</div>
      <div class="meta">${esc(f.model)} · <b>${esc(ggufName(cfg))}</b></div>
      <div class="meta dim2">${esc(cfg.file)}</div>
      <div class="chips">${chips(cfg)}</div>
      <div class="row"><span class="v">${tok.toFixed(1)}</span><span class="k">tok/s</span><span class="v">${dec.toFixed(1)}</span><span class="k">decode</span><span class="v">${ttft.toFixed(0)}</span><span class="k">ttft</span></div>
      </div>`;
  });

  // Per-prompt comparison table
  const promptNames = [...new Set(rows.map((r) => r.Prompt))];
  let tableRows = "";
  for (const pn of promptNames) {
    const cells = configs.map((c) => {
      const rs = rows.filter((r) => r.Config === c.name && r.Prompt === pn);
      if (rs.length === 0) return "<td class='dim'>-</td>";
      const m = median(rs.map((r) => r.TokPerSec));
      const g = rs.find((r) => r.QAGrade)?.QAGrade;
      return `<td>${m.toFixed(1)}${g ? ` <span class='grade'>${esc(g)}</span>` : ""}</td>`;
    });
    tableRows += `<tr><td>${esc(pn)}</td>${cells.join("")}</tr>`;
  }

  // Grade distribution (quality mode)
  let gradeHtml = "";
  const graded = rows.filter((r) => r.QAGrade);
  if (graded.length > 0) {
    const grades = ["A", "B+", "B", "C", "D", "F"];
    gradeHtml = "<div class='sec'>grade distribution</div><table><tr><th>config</th>" +
      grades.map((g) => `<th>${g}</th>`).join("") + "</tr>";
    for (const cfg of configs) {
      const counts = grades.map((g) => graded.filter((r) => r.Config === cfg.name && r.QAGrade === g).length);
      gradeHtml += `<tr><td>${esc(cfg.name)}</td>` + counts.map((n) => `<td>${n || "-"}</td>`).join("") + "</tr>";
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
    const list = byConfig.get(cfg.name) ?? [];
    if (list.length === 0) continue;
    const tok = median(list.map((r) => r.TokPerSec));
    const ttft = median(list.map((r) => r.TTFT_Ms));
    const s = tldrRows.find((e) => e.cfg === cfg.name)?.s;
    dataLines.push(`CONFIG: ${cfg.name} (${ggufName(cfg)}, ctx ${cfg.facets.ctx}) | TLDR score ${s ? s.score.toFixed(1) + "/10" : "n/a"} grade mode ${s?.gradeMode ?? "-"} | ${tok.toFixed(1)} tok/s median TTFT ${ttft.toFixed(0)}ms | PSA err/warn avg ${s ? `${s.avgPsaE}/${s.avgPsaW}` : "n/a"}`);
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
    analysisHtml = `<div class='sec'>analysis · deepseek-v4-flash</div><div class='analysis-text'>${esc(verdict).replace(/\n/g, "<br>")}</div>`;
  } else if (setName === "coding") {
    analysisHtml = "<div class='sec'>analysis</div><p class='dim'>Skipped: DEEPSEEK_API_KEY not set.</p>";
  }

  const failHtml = failures.length > 0
    ? `<div class='sec'>failures</div><pre class='dim'>${esc(failures.join("\n"))}</pre>`
    : "";

  const when = new Date();
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>beellama-tui benchmark — ${esc(setName)}</title>
<style>
  :root { --bg:#0b0d10; --panel:#11151a; --line:#1c232b; --txt:#c9d4dc; --mut:#5c6a76; --acc:#39ff6a; --acc2:#7dff9e; }
  * { box-sizing:border-box; }
  body { background:var(--bg); color:var(--txt); font:13px/1.45 'JetBrains Mono','Cascadia Code',Consolas,monospace; margin:20px auto; max-width:1280px; }
  h1 { font-size:15px; font-weight:600; margin:0 0 2px; letter-spacing:.3px; }
  h1 b { color:var(--acc); }
  .sub { color:var(--mut); font-size:11px; margin-bottom:14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:10px; margin:12px 0; }
  .card { border:1px solid var(--line); border-radius:6px; padding:10px 12px; background:var(--panel); }
  .cfg { font-size:12px; color:#e8eef2; margin-bottom:2px; }
  .cfg .idx { display:inline-block; background:#1d2833; color:var(--mut); border-radius:3px; padding:0 5px; margin-right:7px; font-size:10px; }
  .meta { font-size:11px; color:var(--txt); word-break:break-all; }
  .meta.dim2 { color:var(--mut); }
  .chips { margin:6px 0; line-height:1.9; }
  .chip { display:inline-block; border:1px solid var(--line); border-radius:3px; padding:0 6px; margin-right:4px; font-size:10px; color:var(--txt); background:#151b21; }
  .chip.hot { color:#ffd60a; border-color:#3a3320; }
  .row { display:flex; gap:14px; align-items:baseline; margin-top:6px; }
  .row .v { font-size:17px; font-weight:600; color:#e8eef2; }
  .row .k { color:var(--mut); font-size:10px; margin-right:6px; }
  .sec { color:var(--mut); text-transform:uppercase; letter-spacing:1.5px; font-size:10px; margin:22px 0 6px; }
  table { border-collapse:collapse; margin:6px 0; width:auto; }
  th,td { padding:3px 10px; text-align:right; font-size:12px; border-bottom:1px solid var(--line); }
  th:first-child, td:first-child { text-align:left; color:#e8eef2; }
  thead th { color:var(--mut); font-weight:500; font-size:10px; text-transform:uppercase; letter-spacing:.5px; border-bottom:1px solid #2a343e; }
  tr:hover td { background:#141a20; }
  .tldr td b { color:var(--acc); }
  .tldr .winner td { background:#12200f; }
  .grade { color:var(--mut); font-size:10px; }
  .dim { color:var(--mut); }
  .analysis-text { white-space:normal; max-width:900px; color:var(--txt); }
  summary { cursor:pointer; color:var(--mut); font-size:11px; text-transform:uppercase; letter-spacing:1px; }
  details[open] summary { margin-bottom:6px; }
  .cols { display:flex; gap:32px; align-items:flex-start; flex-wrap:wrap; }
  .col { min-width:340px; }
</style></head><body>
<h1><b>beellama-tui</b> benchmark · ${esc(setTitle(setName))} · ${esc(stamp)}</h1>
<div class="sub">${rows.length} rows · ${configs.length} config(s) · ${runsOf(rows)} runs per prompt (median shown) · host ${esc(hostName())}</div>
${tldrHtml}
<div class="sec">configurations under test</div>
<div class="grid">${cardsHtml}</div>
<div class="cols">
  <div class="col">
    <div class="sec">per-prompt median tok/s</div>
    <table><thead><tr><th>prompt</th>${configs.map((c) => `<th>${esc(c.name)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table>
  </div>
  <div class="col">${gradeHtml}
  </div>
</div>
${analysisHtml}${allHtml}${failHtml}
</body></html>`;

  await writeFile(join(outDir, "results.html"), html);
}

function ggufName(c: ResolvedConfig): string {
  const base = c.model.gguf.replaceAll("\\", "/").split("/").pop() ?? c.model.gguf;
  return base.replace(/\.gguf$/i, "");
}

function shortQ(q?: string): string {
  return (q ?? "").replace(/^q\d+_[a-z0-9]+$/i, (m) => m.toUpperCase()).replace(/^(q8|q4|iq4|iq3)/i, "$1");
}

function shortName(p: string): string {
  const base = p.replaceAll("\\", "/").split("/").pop() ?? p;
  return base.replace(/\.gguf$/i, "").replace(/-?mtp/i, " mtp");
}

const CHIP_LABELS: Record<string, string> = {
  provider: "lab", quant: "quant", ctx: "ctx", spec: "spec",
};

function chips(c: ResolvedConfig): string {
  const f = c.facets;
  const out: string[] = [
    chip("lab", f.provider),
    chip("quant", f.quant),
    chip("ctx", String(f.ctx)),
  ];
  if (f.spec !== "none") out.push(chip("spec", f.spec));
  if (f.think) out.push(chip("mode", "think"));
  if (f.vision) out.push(chip("io", "vision"));
  if (c.cache_k || c.cache_v) out.push(chip("kv", `${shortQ(c.cache_k)}/${shortQ(c.cache_v)}`));
  if (c.batch || c.ubatch) out.push(chip("b", [c.batch, c.ubatch].filter(Boolean).join("/")));
  if (c.draft?.gguf) out.push(chip("draft", shortName(c.draft.gguf)));
  if (c.ngl === "all" || c.ngl >= 999) out.push(chip("ngl", "all"));
  else if (typeof c.ngl === "number") out.push(chip("ngl", String(c.ngl)));
  if (c.flash_attn) out.push(chip("attn", "fa"));
  void CHIP_LABELS;
  return out.join("");
}

function chip(k: string, v: string): string {
  return `<span class="chip${k === "quant" ? " hot" : ""}">${k}·${v}</span>`;
}

function runsOf(rows: BenchResultRow[]): number {
  if (rows.length === 0) return 0;
  const first = rows[0];
  return rows.filter((r) => r.Config === first.Config && r.Prompt === first.Prompt).length;
}

const SET_TITLES: Record<string, string> = {
  standard: "PowerShell Coding",
  coding: "PowerShell Coding",
  longctx: "Long Context",
};

function setTitle(setName: string): string {
  return SET_TITLES[setName] ?? setName;
}

function hostName(): string {
  try {
    return os.hostname().toLowerCase().split(".")[0];
  } catch {
    return "";
  }
}

