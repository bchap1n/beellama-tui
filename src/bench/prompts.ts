// Prompt-set loading + LongCtx haystack expansion (faithful port of Expand-LongCtxPrompts).
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export interface PromptMessage {
  role: string;
  content: string;
}

export interface PromptDef {
  name: string;
  type: string;
  messages: PromptMessage[];
  targetChars?: number;
  needleOffset?: number;
  needle?: string;
  needles?: { offset: number; text: string }[];
}

export type SetName = "standard" | "coding" | "longctx";

const SET_FILES: Record<SetName, string> = {
  standard: "prompts.json",
  coding: "prompts-coding.json",
  longctx: "prompts-longctx.json",
};

export const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts");

export async function loadPromptSet(set: SetName): Promise<PromptDef[]> {
  const raw = JSON.parse(await readFile(join(PROMPTS_DIR, SET_FILES[set]), "utf8")) as PromptDef[];
  if (set === "longctx") return expandLongCtx(raw, await loadHaystackSeed());
  return raw;
}

// Port of Expand-LongCtxPrompts (run_benchmark.ps1 lines 23-85): pad user content with
// seeded haystack lines to targetChars, then insert needles at relative offsets.
export function expandLongCtx(prompts: PromptDef[], seedText: string): PromptDef[] {
  const seedLines = seedText.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (seedLines.length === 0) throw new Error("haystack seed is empty");

  return prompts.map((p) => {
    const target = p.targetChars && p.targetChars > 0 ? p.targetChars : 500000;
    const parts: string[] = [];
    let len = 0;
    let i = 0;
    while (len < target) {
      const line = `[${p.name} p=${i}] ${seedLines[i % seedLines.length]}`;
      parts.push(line);
      len += line.length + 1;
      i++;
    }
    let hay = parts.join("\n");
    if (hay.length > target) hay = hay.slice(0, target);

    const inserts: { offset: number; text: string }[] = [];
    if (p.needle !== undefined && p.needleOffset !== undefined) {
      inserts.push({ offset: p.needleOffset, text: p.needle });
    }
    if (p.needles) inserts.push(...p.needles);
    inserts.sort((a, b) => b.offset - a.offset);
    for (const n of inserts) {
      const pos = Math.min(hay.length, Math.trunc(n.offset * hay.length));
      hay = hay.slice(0, pos) + "\n" + n.text + "\n" + hay.slice(pos);
    }

    const messages = p.messages.map((m) => ({ ...m }));
    messages[1].content = hay + "\n\n" + messages[1].content;
    const { targetChars: _t, needleOffset: _o, needle: _n, needles: _ns, ...rest } = p;
    return { ...rest, messages };
  });
}

export function loadHaystackSeed(): Promise<string> {
  return readFile(join(PROMPTS_DIR, "haystack-seed.txt"), "utf8");
}

