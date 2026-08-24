// Inline benchmark panel: scope, prompt set, runs; live progress; open report.
import { Box, Text } from "ink";
import type { BenchProgress } from "../bench/runner.ts";

export type Scope = "selected" | "filtered" | "all" | "picked";

export const SCOPE_LABELS: Record<Scope, string> = {
  selected: "highlighted",
  filtered: "filtered",
  all: "all",
  picked: "picked",
};

export interface BenchPanelState {
  open: boolean;
  focus: 0 | 1 | 2; // 0 scope, 1 prompts, 2 runs
  scope: Scope;
  picked: Set<string>;
  set: "standard" | "coding" | "longctx";
  runs: number;
  running: boolean;
  progress?: BenchProgress;
  summary?: string;
  resultDir?: string;
}

const SCOPES: Scope[] = ["selected", "filtered", "all", "picked"];
const SETS = ["standard", "coding", "longctx"] as const;
export const SET_LABELS: Record<string, string> = {
  standard: "Mixed (code + reasoning)",
  coding: "PowerShell Coding",
  longctx: "Long Context",
};

export function Benchmark(props: {
  state: BenchPanelState;
  targets: string[];
  selectedName?: string;
  visibleCount: number;
  totalCount: number;
  filtersActive: boolean;
}): React.ReactElement {
  const s = props.state;
  const marker = (row: number, active: boolean) => (active ? "▸" : " ");
  if (!s.open && !s.running) return <Text> </Text>;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={s.running ? "yellow" : "green"} paddingX={1}>
      <Text bold color={s.running ? "yellow" : "green"}>
        {s.running ? "benchmark running — esc abort" : "benchmark setup — ↑/↓ move · space/←→ change · enter start · esc close"}
      </Text>
      {!s.running ? (
        <>
          <Text>
            {"  which configs?  "}
            {SCOPES.map((sc) => (
              <Text key={sc} color={s.focus === 0 && s.scope === sc ? "greenBright" : s.scope === sc ? undefined : "gray"}>
                {s.focus === 0 && s.scope === sc ? "❯ " : "  "}
                {SCOPE_LABELS[sc]}{sc === "picked" ? ` (${s.picked.size})` : ""}{sc === "filtered" && props.filtersActive ? ` (${props.visibleCount})` : ""}
                {sc === "all" ? ` (${props.totalCount})` : ""}{"  "}
              </Text>
            ))}
          </Text>
          <Text dimColor>  ↳ {scopeExplain(s, props)}</Text>
          <Text dimColor>  ↳ which prompt set to run against the configs above</Text>
          <Text>
            {"  prompts:       "}
            {SETS.map((st, i) => (
              <Text key={st} color={s.focus === 1 && s.set === st ? "greenBright" : s.set === st ? undefined : "gray"}>
                {s.focus === 1 && s.set === st ? "❯ " : "  "}{SET_LABELS[st] ?? st}{i < SETS.length - 1 ? "  ·  " : ""}
              </Text>
            ))}
          </Text>
          <Text color={s.focus === 2 ? "greenBright" : undefined}>
            {"  runs per config "}{s.focus === 2 ? "❯ " : "  "}{s.runs}
            {s.focus !== 2 && <Text dimColor>  (↑/↓ to focus, ←/→ to change)</Text>}
          </Text>
          <Text dimColor>
            {"  will run: "}
            {props.targets.length > 0
              ? (props.targets.length > 4 ? `${props.targets.slice(0, 3).join(", ")} +${props.targets.length - 3} more` : props.targets.join(", "))
              : "(nothing — change which configs?)"}
          </Text>
        </>
      ) : s.progress ? (
        <>
          <Text>
            {"  config  "}<Text color="greenBright">{s.progress.configIndex + 1}/{s.progress.configCount}</Text> [{s.progress.configName}]
          </Text>
          <Text>
            {"  prompt  "}{s.progress.promptIndex}/{s.progress.promptCount} · run {s.progress.runIndex}/{s.progress.runCount} · {s.progress.phase}
            {s.progress.tokPerSec > 0 ? ` · ${s.progress.tokPerSec.toFixed(1)} tok/s` : ""}
          </Text>
        </>
      ) : (
        <Text dimColor>  starting…</Text>
      )}
      {s.summary && <Text color="greenBright">  {s.summary}</Text>}
      {s.resultDir && !s.running && <Text dimColor>  o — open {s.resultDir}/results.html</Text>}
    </Box>
  );
}

function scopeExplain(s: BenchPanelState, p: { selectedName?: string; visibleCount: number; totalCount: number; filtersActive: boolean }): string {
  switch (s.scope) {
    case "selected": return p.selectedName ? `only [${p.selectedName}] — the row your cursor is on` : "nothing selected";
    case "filtered": return p.filtersActive ? `every config matching your filter/facets (${p.visibleCount})` : `no filters set — this means every config (${p.visibleCount})`;
    case "all": return `every loaded config (${p.totalCount})`;
    case "picked": return s.picked.size > 0 ? `${s.picked.size} config(s) you tagged with space` : "nothing tagged yet — press space on config rows first";
  }
}
