// Config table with row highlight and facet columns.
import { Box, Text } from "ink";
import type { ResolvedConfig } from "../types.ts";

const COLS = [
  { key: "model", label: "Model", width: 26 },
  { key: "quant", label: "Quant", width: 14 },
  { key: "ctx", label: "Ctx", width: 8 },
  { key: "provider", label: "Provider", width: 12 },
  { key: "spec", label: "Spec", width: 7 },
  { key: "think", label: "Think", width: 6 },
  { key: "vision", label: "Vis", width: 4 },
  { key: "q", label: "Q", width: 2 },
] as const;

function cell(v: string, width: number): string {
  return v.length > width ? v.slice(0, width - 1) + "…" : v.padEnd(width);
}

export function ConfigList(props: {
  rows: ResolvedConfig[];
  selected: number;
}): React.ReactElement {
  const header = cell("Name", 30) + COLS.map((c) => cell(c.label, c.width)).join("");
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
          f.provider,
          f.spec,
          f.think ? "on" : "off",
          f.vision ? "y" : "-",
          f.quality ? "*" : "-",
        ];
        const line = cell(cells[0], 30) + cells.slice(1).map((v, ci) => cell(v, COLS[ci].width)).join("");
        const selected = i === props.selected;
        return (
          <Text key={r.name} backgroundColor={selected ? "#1e5c31" : undefined} color={selected ? "greenBright" : undefined}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
