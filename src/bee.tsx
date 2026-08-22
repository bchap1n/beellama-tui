// Pixel-art bee face shared by the TUI header and benchmark reports.
// Drawn programmatically on a character grid: 1 = body (bright yellow),
// 2 = wings (dim), 3 = antenna. Empty cells show terminal background.
import React, { useEffect, useState } from "react";
import { Text } from "ink";

type Cell = 0 | 1 | 2 | 3;
const W = 17;
const H = 10;

function blank(): Cell[][] {
  return Array.from({ length: H }, () => Array<Cell>(W).fill(0));
}

function fillEllipse(g: Cell[][], cx: number, cy: number, rx: number, ry: number, v: Cell): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) g[y][x] = v;
    }
  }
}

function set(g: Cell[][], x: number, y: number, v: Cell): void {
  if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = v;
}

function baseGrid(wingsUp: boolean): Cell[][] {
  const g = blank();

  // Wings behind the head: two blobs, raised or out to the sides.
  if (wingsUp) {
    for (let y = 0; y <= 1; y++)
      for (let x = 2; x <= 4; x++) set(g, x, y, 2);
    for (let y = 0; y <= 1; y++)
      for (let x = 12; x <= 14; x++) set(g, x, y, 2);
  } else {
    for (let y = 2; y <= 3; y++) {
      set(g, 0, y, 2); set(g, 1, y, 2); set(g, 2, y, 2);
      set(g, 14, y, 2); set(g, 15, y, 2); set(g, 16, y, 2);
    }
  }

  // Head: solid ellipse.
  fillEllipse(g, 8, 5, 6.4, 4.2, 1);

  // Big compound eyes punched out of the face.
  fillEllipse(g, 5.5, 4.6, 2.4, 2.1, 0);
  fillEllipse(g, 10.5, 4.6, 2.4, 2.1, 0);
  // Glints so the eyes read as glossy, not holes.
  set(g, 5, 4, 1);
  set(g, 11, 4, 1);

  // Antennae: stalks leaning out with dot tips.
  set(g, 4, 0, 3); set(g, 5, 1, 3);
  set(g, 12, 0, 3); set(g, 11, 1, 3);

  // Mandibles: two hooked prongs curving inward under the chin.
  set(g, 5, 8, 1); set(g, 6, 8, 1);
  set(g, 6, 9, 1);
  set(g, 10, 8, 1); set(g, 11, 8, 1);
  set(g, 10, 9, 1);

  return g;
}

export interface BeeFrame {
  lines: string[][]; // [row][segment] pairs of [text, kind]
}

type Seg = [string, string]; // [text, kind]
function toSegments(g: Cell[][]): Seg[][] {
  void 0;
  return g.map((row) => {
    const segs: Seg[] = [];
    let cur = "";
    let curV: Cell = 0;
    const flush = (): void => {
      if (cur) segs.push([cur, String(curV)]);
    };
    for (const v of row) {
      if (v === curV) cur += v === 0 ? " " : "█";
      else {
        flush();
        curV = v;
        cur = v === 0 ? " " : "█";
      }
    }
    flush();
    return segs;
  });
}

export const BEE_FRAMES: Seg[][][] = [toSegments(baseGrid(false)), toSegments(baseGrid(true))];

const KIND_COLORS: Record<string, string> = {
  "1": "#ffd60a", // body bright yellow
  "2": "#8a7516", // wings dim
  "3": "#b39c22", // antennae mid
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
            kind === "0"
              ? <Text key={si}>{text}</Text>
              : <Text key={si} color={KIND_COLORS[kind]}>{text}</Text>,
          )}
          {ri < frame.length - 1 ? "\n" : ""}
        </Text>
      ))}
    </Text>
  );
}

// ---------- HTML report variant ----------

export function beeHtml(): { css: string; html: string } {
  const css = `
  .bee-wrap { position:relative; display:inline-block; float:left; margin-right:28px; height:10em; }
  .bee { font-family:'JetBrains Mono',monospace; line-height:1.05; margin:0; position:absolute; top:0; left:0; font-size:10px; }
  .bee .b { color:#ffd60a; } .bee .w { color:#8a7516; } .bee .a { color:#b39c22; }
  .bee.fB { opacity:0; animation: flap 340ms steps(1) infinite; }
  @keyframes flap { 0%,49% { opacity:0; } 50%,100% { opacity:1; } }
  .bee.fA { animation: flapA 340ms steps(1) infinite; }
  @keyframes flapA { 0%,49% { opacity:1; } 50%,100% { opacity:0; } }`;

  const render = (g: Cell[][]): string =>
    g.map((row) =>
      row.map((v) => v === 0 ? "<span> </span>"
        : `<span class="${v === 1 ? "b" : v === 2 ? "w" : "a"}">█</span>`).join(""))
      .join("\n");

  const html =
    `<div class="bee-wrap"><pre class="bee fA">${render(baseGrid(false))}</pre>` +
    `<pre class="bee fB">${render(baseGrid(true))}</pre></div>`;
  return { css, html };
}
