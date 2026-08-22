// Pixel-art bee face shared by the TUI header and benchmark reports.
// Hand-authored 2-frame animation: big compound eyes, mandibles, wing flap.
// Art chars: d = body (bright yellow), w = wings (dim gold), e = eyes (near-black).

export type Seg = [string, string]; // [text, kind]

// Frame A: wings out to the sides.
const FRAME_A: string[] = [
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

// Frame B: wings raised above the head.
const FRAME_B: string[] = [
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

// Eye sockets punched into rows 4-6 (dark cells inside the yellow face).
const EYES: Array<[number, number]> = [
  [4, 5], [4, 6], [5, 4], [5, 5], [5, 6], [6, 5], [6, 6],
  [4, 10], [4, 11], [5, 10], [5, 11], [5, 12], [6, 10], [6, 11],
];
for (const frame of [FRAME_A, FRAME_B]) {
  for (const [y, x] of EYES) {
    if (frame[y]?.[x] === "d") {
      frame[y] = frame[y].slice(0, x) + "e" + frame[y].slice(x + 1);
    }
  }
}

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
        ch === "d" ? "1" :
        ch === "w" ? "2" :
        ch === "e" ? "3" : "0";
      if (k === curK) cur += k === "0" ? " " : "█";
      else { flush(); curK = k; cur = k === "0" ? " " : "█"; }
    }
    flush();
    return segs;
  });
}

export const BEE_FRAMES: Seg[][][] = [toSegments(FRAME_A), toSegments(FRAME_B)];

import React, { useEffect, useState } from "react";
import { Text } from "ink";

const KIND_COLORS: Record<string, string | undefined> = {
  "1": "#ffd60a", // body bright yellow
  "2": "#8a7516", // wings dim gold
  "3": "#241f00", // eyes near-black on yellow face
};

export function Bee(): React.ReactElement {
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
            kind === "0" || !KIND_COLORS[kind]
              ? <Text key={si}>{text}</Text>
              : <Text key={si} color={KIND_COLORS[kind]}>{text}</Text>,
          )}
          {ri < frame.length - 1 ? "\n" : ""}
        </Text>
      ))}
    </Text>
  );
}

export function beeHtml(): { css: string; html: string } {
  const css = `
  .bee-wrap { position:relative; display:inline-block; float:left; margin-right:28px; height:10em; }
  .bee { font-family:'JetBrains Mono',monospace; line-height:1.05; margin:0; position:absolute; top:0; left:0; font-size:10px; }
  .bee .b { color:#ffd60a; } .bee .w { color:#8a7516; } .bee .e { color:#241f00; }
  .bee.fB { opacity:0; animation: flapB 340ms steps(1) infinite; }
  @keyframes flapB { 0%,49% { opacity:0; } 50%,100% { opacity:1; } }
  .bee.fA { animation: flapA 340ms steps(1) infinite; }
  @keyframes flapA { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }`;

  const cls: Record<string, string> = { "1": "b", "2": "w", "3": "e" };
  const render = (segs: Seg[][]): string =>
    segs.map((row) =>
      row.map(([text, kind]) =>
        kind === "0" ? `<span>${text.replace(/&/g, "&amp;")}</span>`
        : `<span class="${cls[kind]}">${text}</span>`).join(""))
      .join("\n");

  const html =
    `<div class="bee-wrap"><pre class="bee fA">${render(BEE_FRAMES[0])}</pre>` +
    `<pre class="bee fB">${render(BEE_FRAMES[1])}</pre></div>`;
  return { css, html };
}
