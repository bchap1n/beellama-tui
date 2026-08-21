// ASCII bee face art shared by the TUI header and benchmark reports.
// 16-bit retro style: yellow-on-black, big eyes, mandibles.

// TUI variant: 5 lines, compact, fits a header strip.
export const BEE_TUI = [
  ",,,      ",
  " (O)(O)  ",
  "  \\~~/   ",
  "  {vv}~  ",
  "  \"\"\"\"   ",
];

// Report variant: larger, used as <pre> in HTML. Eyes + mandibles only.
export const BEE_HTML = String.raw`
     ,,,,,
    | O O |
    |  \^/  |
     \_v_/
    /|''|\
     '----'
   b e e l l a m a
`;

export function beeHtml(color = "#ffd60a"): string {
  return `<pre class="bee" style="color:${color}">${BEE_HTML.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
}
