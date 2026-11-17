// Config table with row highlight and facet columns.
import { Box, Text } from "ink";
import type { ResolvedConfig } from "../types.ts";

const COLS = [
  { key: "model", label: "Model", width: 26 },
  { key: "quant", label: "Quant", width: 14 },
  { key: "ctx", label: "Ctx", width: 8 },
  { key: "size", label: "Size GB", width: 8 },
  { key: "engine", label: "Engine", width: 10 },
  { key: "provider", label: "Provider", width: 12 },
  { key: "spec", label: "Spec", width: 7 },
  { key: "think", label: "Think", width: 7 },
  { key: "vision", label: "Vis", width: 4 },
  { key: "q", label: "Q", width: 2 },
] as const;

function cell(v: string, width: number): string {
  return v.length > width ? v.slice(0, width - 1) + "…" : v.padEnd(width);
}

export function ConfigList(props: {
  rows: ResolvedConfig[];
  selected: number;
  pins: Set<string>;
}): React.ReactElement {
  // Name column fits the longest name plus one space, so no name touches Model.
  const nameWidth = Math.max("Name".length, ...props.rows.map((r) => r.name.length)) + 1;
  const header = cell("Name", nameWidth) + COLS.map((c) => cell(c.label, c.width)).join("");
  return (
    <Box flexDirection="column">
      <Text color="green" bold>{header}</Text>
      {props.rows.map((r, i) => {
        const f = r.facets;
        const cells = [
          r.name,
          f.model,
          f.quant,
          String(f.ctx),
          f.size_gb === undefined ? "-" : f.size_gb.toFixed(1),
          f.engine,
          f.provider,
          f.spec,
          !r.reasoning ? "[off]" : r.reasoning_effort === "xhigh" ? "[xhigh]" : r.reasoning_effort === "high" ? "[high]" : r.reasoning_effort === "medium" ? "[med]" : r.reasoning_effort === "low" ? "[low]" : "[on]",
          f.vision ? "y" : "-",
          f.quality ? "*" : "-",
        ];
        const line = cell(cells[0], nameWidth) + cells.slice(1).map((v, ci) => cell(v, COLS[ci].width)).join("");
        const selected = i === props.selected;
        const pinned = props.pins.has(r.name);
        return (
          <Text key={r.name} backgroundColor={selected ? "#1e5c31" : undefined} color={selected ? "greenBright" : pinned ? "blue" : undefined}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
