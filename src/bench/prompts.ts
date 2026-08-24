// Prompt-set loading + LongCtx haystack expansion with realistic code filler.
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appFile } from "../approot.ts";

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
  expect?: string; // LongContext grading: substring the answer must contain (case-insensitive)
}

export type SetName = "standard" | "coding" | "longctx";

const SET_FILES: Record<SetName, string> = {
  standard: "prompts.json",
  coding: "prompts-coding.json",
  longctx: "prompts-longctx.json",
};


export async function loadPromptSet(set: SetName): Promise<PromptDef[]> {
  const raw = JSON.parse(await readFile(appFile("prompts", SET_FILES[set]), "utf8")) as PromptDef[];
  if (set === "longctx") return expandLongCtx(raw, await loadHaystackSeed());
  return raw;
}

// Pad user content with filler lines to targetChars, then insert needles at
// relative offsets. Filler is real PowerShell/TypeScript source when available
// (high-entropy, closer to production use than repeated seed lines); the
// seeded haystack is the fallback. Block order is deterministic per prompt so
// runs are reproducible.
export function expandLongCtx(prompts: PromptDef[], seedText: string): PromptDef[] {
  const seedLines = seedText.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (seedLines.length === 0) throw new Error("haystack seed is empty");

  return prompts.map((p) => {
    const target = p.targetChars && p.targetChars > 0 ? p.targetChars : 500000;
    const hay = buildHaystack(p.name, target, seedLines);
    const inserts: { offset: number; text: string }[] = [];
    if (p.needle !== undefined && p.needleOffset !== undefined) {
      inserts.push({ offset: p.needleOffset, text: p.needle });
    }
    if (p.needles) inserts.push(...p.needles);
    inserts.sort((a, b) => b.offset - a.offset);
    let padded = hay;
    for (const n of inserts) {
      const pos = Math.min(padded.length, Math.trunc(n.offset * padded.length));
      padded = padded.slice(0, pos) + "\n" + n.text + "\n" + padded.slice(pos);
    }

    const messages = p.messages.map((m) => ({ ...m }));
    messages[1].content = padded + "\n\n" + messages[1].content;
    const { targetChars: _t, needleOffset: _o, needle: _n, needles: _ns, ...rest } = p;
    return { ...rest, messages };
  });
}

// Deterministic xorshift from a string seed.
function seededRandom(seedText: string): () => number {
  let s = 0;
  for (const ch of seedText) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000; // excludes 1.0, keeps Fisher-Yates in bounds
  };
}


// Real-code filler blocks, shuffled deterministically. Empty array -> caller
// falls back to seed lines.
let corpusCache: string[] | undefined;

function loadCodeCorpus(): string[] {
  if (corpusCache) return corpusCache;
  const roots = [
    join(appFile("prompts", ".."), ".."), // repo root of this TUI
  ];
  const beellamaRun = join(roots[0], "..", "beellama", "run");
  const dirs = [
    join(beellamaRun),
    join(roots[0], "src"),
    join(roots[0], "scripts"),
  ];
  const blocks: string[] = [];
  for (const dir of dirs) {
    try {
      const names = readdirSync(dir, { recursive: true }) as string[];
      for (const name of names) {
        if (!/\.(ps1|ts|tsx)$/.test(name) || /node_modules|dist|archive/.test(name)) continue;
        try {
          const text = readFileSync(join(dir, String(name)), "utf8");
          // Chunk into ~120-line blocks so one giant file spreads across many.
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i += 120) {
            const chunk = lines.slice(i, i + 120).join("\n").trim();
            if (chunk.length > 400) blocks.push(chunk);
          }
        } catch {
          // unreadable file — skip
        }
      }
    } catch {
      // missing dir — skip
    }
  }
  corpusCache = blocks;
  return blocks;
}

function buildHaystack(promptName: string, target: number, seedLines: string[]): string {
  const rand = seededRandom(promptName);
  const corpus = loadCodeCorpus();
  const parts: string[] = [];
  if (corpus.length > 0) {
    // Shuffle block order per prompt (deterministic), then take until filled.
    const pool = [...corpus];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let len = 0;
    let round = 0;
    while (len < target && pool.length > 0) {
      const chunk = pool[round % pool.length];
      parts.push(`# --- ${promptName} block ${round} ---\n${chunk}`);
      len += chunk.length + 64;
      round++;
    }
  } else {
    let len = 0;
    let i = 0;
    while (len < target) {
      const line = `[${promptName} p=${i}] ${seedLines[i % seedLines.length]}`;
      parts.push(line);
      len += line.length + 1;
      i++;
    }
  }
  const hay = parts.join("\n");
  return hay.length > target ? hay.slice(0, target) : hay;
}

export function loadHaystackSeed(): Promise<string> {
  return readFile(appFile("prompts", "haystack-seed.txt"), "utf8");
}

