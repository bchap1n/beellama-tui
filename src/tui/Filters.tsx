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
}): React.ReactElement {
  const providers = [...new Set(props.rows.map((r) => r.facets.provider))].sort();
  const specs = [...new Set(props.rows.map((r) => r.facets.spec))].sort();
  const toggle = (facet: keyof FacetFilters, value: string, on: boolean) => (
    <Text key={facet + value} color={on ? "greenBright" : "gray"}>
      {on ? "[x] " : "[ ] "}{value}{"  "}
    </Text>
  );
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Text bold color="green">filters — space toggles under cursor, enter/esc close, c clear all</Text>
      <Box marginTop={1}><Text>provider: </Text>{providers.map((p) => toggle("provider", p, props.filters.provider.has(p)))}</Box>
      <Box><Text>think:    </Text>{["on", "off"].map((v) => toggle("think", v, props.filters.think.has(v)))}</Box>
      <Box><Text>vision:   </Text>{["on", "off"].map((v) => toggle("vision", v, props.filters.vision.has(v)))}</Box>
      <Box><Text>quality:  </Text>{["yes", "no"].map((v) => toggle("quality", v, props.filters.quality.has(v)))}</Box>
      <Box><Text>spec:     </Text>{specs.map((s) => toggle("spec", s, props.filters.spec.has(s)))}</Box>
    </Box>
  );
}
