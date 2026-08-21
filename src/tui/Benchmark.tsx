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
      <Text bold color={s.running ? "yellow" : "green"}>
        {s.running ? "benchmark running — esc abort" : "benchmark setup — ↑/↓ move · space/←→ change · enter start · esc close"}
      </Text>
      {!s.running ? (
        <>
          <Text>
            {"  scope   "}
            <Text color={s.scopeRow === 0 ? "greenBright" : undefined}>{s.scopeRow === 0 ? "❯ " : "  "}{labelOf(SCOPES[0], s)}</Text>
            {"   "}
            {SCOPES.slice(1).map((sc, i) => (
              <Text key={sc} color={s.scopeRow === i + 1 ? "greenBright" : undefined}>
                {s.scopeRow === i + 1 ? "❯ " : "  "}{labelOf(sc, s)}{"  "}
              </Text>
            ))}
          </Text>
          <Text>
            {"  prompts "}
            {SETS.map((st, i) => (
              <Text key={st} color={s.setRow === i ? "greenBright" : undefined}>
                {s.setRow === i ? "❯ " : "  "}{st}{i < SETS.length - 1 ? "  " : ""}
              </Text>
            ))}
          </Text>
          <Text>
            {"  runs    "}
            <Text color={s.runsRow === 6 ? "greenBright" : undefined}>
              {s.runsRow === 6 ? "❯ " : "  "}{s.runs}
            </Text>
            <Text dimColor>  (←/→ when focused)</Text>
          </Text>
          {s.scope === "picked" && (
            <Text dimColor>  picked: {s.picked.size > 0 ? [...s.picked].join(", ") : "(none yet — press space on config rows)"}</Text>
          )}
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

function labelOf(scope: Scope, s: BenchPanelState): string {
  if (scope === "picked") return `picked (${s.picked.size})`;
  return scope;
}
