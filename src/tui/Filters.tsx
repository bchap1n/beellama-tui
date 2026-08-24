// Facet filter modal: toggleable values + clear-all.
import { Box, Text } from "ink";
import type { ResolvedConfig } from "../types.ts";

export interface FacetFilters {
  provider: Set<string>;
  think: Set<string>;
  vision: Set<string>;
  quality: Set<string>;
  spec: Set<string>;
}

export function emptyFilters(): FacetFilters {
  return { provider: new Set(), think: new Set(), vision: new Set(), quality: new Set(), spec: new Set() };
}

export function filtersActive(f: FacetFilters): boolean {
  return f.provider.size > 0 || f.think.size > 0 || f.vision.size > 0 || f.quality.size > 0 || f.spec.size > 0;
}

export function matchesFilters(r: ResolvedConfig, f: FacetFilters): boolean {
  if (f.provider.size > 0 && !f.provider.has(r.facets.provider)) return false;
  if (f.think.size > 0 && !f.think.has(r.facets.think ? "on" : "off")) return false;
  if (f.vision.size > 0 && !f.vision.has(r.facets.vision ? "on" : "off")) return false;
  if (f.quality.size > 0 && !f.quality.has(r.facets.quality ? "yes" : "no")) return false;
  if (f.spec.size > 0 && !f.spec.has(r.facets.spec)) return false;
  return true;
}

export function Filters(props: {
  rows: ResolvedConfig[];
  filters: FacetFilters;
  cursor: number;
  onToggle: (facet: keyof FacetFilters, value: string) => void;
  onClear: () => void;
}): React.ReactElement {
  const providers = [...new Set(props.rows.map((r) => r.facets.provider))].sort();
  const specs = [...new Set(props.rows.map((r) => r.facets.spec))].sort();
  const groups: { facet: keyof FacetFilters; label: string; values: string[] }[] = [
    { facet: "provider", label: "provider", values: providers },
    { facet: "think", label: "think   ", values: ["on", "off"] },
    { facet: "vision", label: "vision  ", values: ["on", "off"] },
    { facet: "quality", label: "quality ", values: ["yes", "no"] },
    { facet: "spec", label: "spec    ", values: specs },
  ];
  let flat = 0;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Text bold color="green">filters — ←/→ move · space toggle · c clear · esc done</Text>
      {groups.map((g) => (
        <Box key={g.facet} marginTop={g.facet === "provider" ? 1 : 0}>
          <Text>{g.label}: </Text>
          {g.values.map((v) => {
            const idx = flat++;
            const on = props.filters[g.facet].has(v);
            const cur = idx === props.cursor;
            return (
              <Text
                key={g.facet + v}
                color={cur ? "blackBright" : on ? "greenBright" : "gray"}
                backgroundColor={cur ? "#1e5c31" : undefined}
              >
                {cur ? "❯ " : "  "}{on ? "[x]" : "[ ]"} {v}{"  "}
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
