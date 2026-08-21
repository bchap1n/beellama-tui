// Model sources panel: shows each configured root and its configs.
import { Box, Text } from "ink";
import type { ResolvedConfig } from "../types.ts";

export function Sources(props: {
  roots: string[];
  rows: ResolvedConfig[];
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">model sources — edit beellama-tui.yaml model_roots to change</Text>
      {props.roots.map((r) => {
        const cfgs = props.rows.filter((c) => {
          const norm = c.model.gguf.replaceAll("\\", "/").toLowerCase();
          const root = r.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
          return norm.startsWith(root + "/");
        });
        const providers = [...new Set(cfgs.map((c) => c.facets.provider))];
        const outside = props.rows.filter((c) => !props.roots.some((rt) => {
          const norm = c.model.gguf.replaceAll("\\", "/").toLowerCase();
          const root = rt.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
          return norm.startsWith(root + "/");
        }));
        void outside;
        return (
          <Text key={r}>
            {r}  <Text dimColor>{cfgs.length} config(s){providers.length > 0 ? ` · ${providers.join(", ")}` : ""}</Text>
          </Text>
        );
      })}
      <Text dimColor>esc/m close</Text>
    </Box>
  );
}
