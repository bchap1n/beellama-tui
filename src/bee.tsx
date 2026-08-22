// ANSI pixel art for the TUI header and benchmark reports.
// Two motifs, selectable: the bee (animated flap) and the RTX 3090 FE (static).
// Art chars per motif map to kind codes; KIND_COLORS maps kinds to colors.

export type Seg = [string, string]; // [text, kind]

export type Motif = "bee" | "rtx3090";

// ---------------- bee (hand-authored 2-frame) ----------------

const BEE_A: string[] = [
  "                 ",
  "  ww         ww  ",
  "   wdddddddddw   ",
  "  dd  dddddd  dd ",
  "  d dd  dd  dd d ",
  "    d  d  d  d   ",
  "    dd d  d dd   ",
  "     dddddddd    ",
  "      d    d     ",
  "     dd    dd    ",
];

const BEE_B: string[] = [
  "   ww      ww    ",
  "    ww    ww     ",
  "   wdddddddddw   ",
  "  dd  dddddd  dd ",
  "  d dd  dd  dd d ",
  "    d  d  d  d   ",
  "    dd d  d dd   ",
  "     dddddddd    ",
  "      d    d     ",
  "     dd    dd    ",
];

const BEE_EYES: Array<[number, number]> = [
  [4, 5], [4, 6], [5, 4], [5, 5], [5, 6], [6, 5], [6, 6],
  [4, 10], [4, 11], [5, 10], [5, 11], [5, 12], [6, 10], [6, 11],
];
for (const frame of [BEE_A, BEE_B]) {
  for (const [y, x] of BEE_EYES) {
    if (frame[y]?.[x] === "d") {
      frame[y] = frame[y].slice(0, x) + "e" + frame[y].slice(x + 1);
    }
  }
}

// ---------------- RTX 3090 Founders Edition (small, static) ----------------
// g = shroud body (dark gray), f = fan blades (silver), c = copper accents,
// x = GEFORCE text area (white), s = slot bracket (gray).
const RTX: string[] = [
  "                                ",
  " ggfgfgfgfgfgfgfgfgfgfgfgfgfgg  ",
  " gffffffffffffffffffffffffffcg  ",
  " gfcc gfc  gfc  gfc  gfc  ccfg  ",
" gfc  gfc  gfc  gfc  gfc   cfg  ",
" gfcc gfc  gfc  gfc  gfc  ccfg  ",
" gffffffffffffffffffffffffffcg  ",
" ggxxxxxxxxxxxxxxxxxxxxxxxxggg  ",
" ggx      R T X 3 0 9 0      xgg ",
" ggggggggggggggggggggggggggggg  ",
"   ss                           ",
"   ss                           ",
];

function toSegments(art: string[]): Seg[][] {
  return art.map((line) => {
    const segs: Seg[] = [];
    let cur = "";
    let curK = "0";
    const flush = (): void => {
      if (cur) segs.push([cur, curK]);
    };
    for (const ch of line) {
      const k =
        ch === "d" || ch === "f" ? "1" :
        ch === "w" ? "2" :
        ch === "e" ? "3" :
        ch === "g" ? "4" :
        ch === "c" ? "5" :
        ch === "x" || /[A-Z0-9]/.test(ch) ? "6" :
        ch === "s" ? "7" : "0";
      const literal = k === "6" && ch !== "x"; // letters render as themselves
      if (k === curK) cur += k === "0" ? " " : literal ? ch : "█";
      else { flush(); curK = k; cur = k === "0" ? " " : literal ? ch : "█"; }
    }
    flush();
    return segs;
  });
}

export const BEE_FRAMES: Seg[][][] = [
  [toSegments(BEE_A)][0] ?? toSegments(BEE_A),
  toSegments(BEE_B),
];
export const RTX_SEGMENTS: Seg[][] = toSegments(RTX);

import React, { useEffect, useState } from "react";
import { Text } from "ink";

const MOTIF_COLORS: Record<string, Record<string, string | undefined>> = {
  bee: {
    "1": "#ffd60a", // body bright yellow
    "2": "#8a7516", // wings dim gold
    "3": "#241f00", // eyes near-black on yellow face
  },
  rtx3090: {
    "1": "#9aa0a6", // fan blades silver
    "4": "#202124", // shroud near-black
    "5": "#b06c3f", // copper accents
    "6": "#e8eaed", // GeForce text pale
    "7": "#5f6368", // bracket gray
  },
};

export function Art(props: { motif?: Motif }): React.ReactElement {
  const motif = props.motif ?? "bee";
  const colors = MOTIF_COLORS[motif];
  if (motif === "rtx3090") {
    return (
      <Text>
        {RTX_SEGMENTS.map((row, ri) => (
          <Text key={ri}>
            {row.map(([text, kind], si) =>
              kind === "0" || !colors[kind]
                ? <Text key={si}>{text}</Text>
                : <Text key={si} color={colors[kind]}>{text}</Text>,
            )}
            {ri < RTX_SEGMENTS.length - 1 ? "\n" : ""}
          </Text>
        ))}
      </Text>
    );
  }
  const [f, setF] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setF((n) => n + 1), 170);
    return () => clearInterval(t);
  }, []);
  const frame = BEE_FRAMES[f % BEE_FRAMES.length];
  return (
    <Text>
      {frame.map((row, ri) => (
        <Text key={ri}>
          {row.map(([text, kind], si) =>
            kind === "0" || !colors[kind]
              ? <Text key={si}>{text}</Text>
              : <Text key={si} color={colors[kind]}>{text}</Text>,
          )}
          {ri < frame.length - 1 ? "\n" : ""}
        </Text>
      ))}
    </Text>
  );
}

// Back-compat export used by App.tsx
export const Bee = Art;

// Tiny static RTX glyph for tight corners: 4 rows, visible on black.
const RTX_TINY: Seg[][] = toSegments([
  "gggggggggggggg",
  "gfg gfg gfg gf",
  "gxxxxxxxxxxxxg",
  "gggggggggggggg",
]);

// Tiny-card palette override: shroud must read on a black terminal.
const TINY_COLORS: Record<string, string | undefined> = {
  ...MOTIF_COLORS.rtx3090,
  "4": "#5f6368", // shroud lifted from near-black
};

export function ArtTiny(): React.ReactElement {
  const colors = TINY_COLORS;

  return (
    <Text>
      {RTX_TINY.map((row, ri) => (
        <Text key={ri}>
          {row.map(([text, kind], si) =>
            kind === "0" || !colors[kind]
              ? <Text key={si}>{text}</Text>
              : <Text key={si} color={colors[kind]}>{text}</Text>,
          )}
          {ri < RTX_TINY.length - 1 ? "\n" : ""}
        </Text>
      ))}
    </Text>
  );
}

export function beeHtml(motif: Motif = "bee"): { css: string; html: string } {
  const palette =
    motif === "bee"
      ? { b: "#ffd60a", w: "#8a7516", e: "#241f00" }
      : { b: "#9aa0a6", w: "#202124", e: "#b06c3f" };
  const css = `
  .art-wrap { display:inline-block; float:left; margin-right:24px; width:34ch; height:11em; position:relative; overflow:hidden; }
  .art { font-family:'JetBrains Mono',monospace; line-height:1.05; margin:0; position:absolute; top:0; left:0; font-size:10px; }
  .art .b { color:${palette.b}; } .art .w { color:${palette.w}; } .art .e { color:${palette.e}; }
  ${motif === "bee" ? `
  .art.fB { opacity:0; animation: flapB 340ms steps(1) infinite; }
  @keyframes flapB { 0%,49% { opacity:0; } 50%,100% { opacity:1; } }
  .art.fA { animation: flapA 340ms steps(1) infinite; }
  @keyframes flapA { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }` : ""}`;

  const cls: Record<string, string> = { "1": "b", "2": "w", "3": "e" };
  const renderOne = (segs: Seg[][]): string =>
    segs.map((row) =>
      row.map(([text, kind]) =>
        kind === "0" ? `<span>${text}</span>`
        : `<span class="${cls[kind] ?? "b"}">${text}</span>`).join(""))
      .join("\n");

  let html: string;
  if (motif === "bee") {
    html =
      `<div class="art-wrap"><pre class="art fA">${renderOne(BEE_FRAMES[0])}</pre>` +
      `<pre class="art fB">${renderOne(BEE_FRAMES[1])}</pre></div>`;
  } else {
    html = `<div class="art-wrap"><pre class="art">${renderOne(RTX_SEGMENTS)}</pre></div>`;
  }
  void palette;
  return { css, html };
}
