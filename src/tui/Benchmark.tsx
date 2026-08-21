// Inline benchmark panel: scope, prompt set, runs; live progress; open report.
import { Box, Text } from "ink";
import type { BenchProgress } from "../bench/runner.ts";

export type Scope = "selected" | "filtered" | "all" | "picked";

export interface BenchPanelState {
  open: boolean;
  scopeRow: number;
  setRow: number;
  runsRow: number;
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

export function Benchmark(props: { state: BenchPanelState }): React.ReactElement {
  const s = props.state;
  const marker = (row: number, active: boolean) => (active ? "▸" : " ");
  if (!s.open && !s.running) return <Text> </Text>;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={s.running ? "yellow" : "green"} paddingX={1}>
      <Text bold color={s.running ? "yellow" : "green"}>{s.running ? "benchmark running" : "benchmark"} — enter start · esc cancel/close</Text>
      {!s.running ? (
        <>
          <Box>
            {SCOPES.map((sc, i) => (
              <Text key={sc} color={s.scopeRow === i ? "greenBright" : undefined}>
                {marker(i, s.scopeRow === i)}{i === s.scopeRow ? "[" : " "}{sc}{i === s.scopeRow ? "]" : " "}{"  "}
              </Text>
            ))}
            {s.scope === "picked" && <Text dimColor>({s.picked.size} picked — space on rows)</Text>}
          </Box>
          <Box>
            {SETS.map((st, i) => (
              <Text key={st} color={s.setRow === i ? "greenBright" : undefined}>
                {marker(i + 3, s.setRow === i)}{i === s.setRow ? "[" : " "}{st}{i === s.setRow ? "]" : " "}{"  "}
              </Text>
            ))}
          </Box>
          <Text color={s.runsRow === 6 ? "greenBright" : undefined}>
            {marker(7, s.runsRow === 6)}runs: ← {s.runs} →
          </Text>
        </>
      ) : s.progress ? (
        <Text>
          config {s.progress.configIndex + 1}/{s.progress.configCount} [{s.progress.configName}] · prompt {s.progress.promptIndex}/{s.progress.promptCount} · run {s.progress.runIndex}/{s.progress.runCount} · {s.progress.phase}
          {s.progress.tokPerSec > 0 ? ` · ${s.progress.tokPerSec.toFixed(1)} tok/s` : ""}
        </Text>
      ) : (
        <Text>starting…</Text>
      )}
      {s.summary && <Text color="greenBright">{s.summary}</Text>}
      {s.resultDir && <Text dimColor>o — open {s.resultDir}/results.html</Text>}
    </Box>
  );
}
