// Inline benchmark panel: prompt set (+ runs where meaningful); live progress; open report.
import { Box, Text } from "ink";
import type { BenchProgress } from "../bench/runner.ts";

export interface BenchPanelState {
  open: boolean;
  focus: 0 | 1; // 0 prompts, 1 runs
  set: "standard" | "longctx" | "coding";
  runs: number;
  running: boolean;
  progress?: BenchProgress;
  summary?: string;
  resultDir?: string;
}

const SETS = ["standard", "longctx", "coding"] as const;

export const SET_LABELS: Record<string, string> = {
  standard: "Classic",
  longctx: "Long Context",
  coding: "PowerShell Coding",
};

// One graded sample per config+prompt; extra runs would only copy the same grade,
// so the coding set hides the runs option entirely.
const SET_EXPLAIN: Record<string, string> = {
  standard: "4 mixed prompts (code + reasoning) — quick all-round speed check",
  longctx: "4 giant haystack prompts (~500k chars) — slow; tests recall at depth",
  coding: "10 PowerShell tasks, each graded once on syntax, PSSA and idiomatic style",
};

export function Benchmark(props: { state: BenchPanelState; targets: string[] }): React.ReactElement {
  const s = props.state;
  if (!s.open && !s.running) return <Text> </Text>;
  const coding = s.set === "coding";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={s.running ? "yellow" : "green"} paddingX={1}>
      <Text bold color={s.running ? "yellow" : "green"}>
        {s.running ? "benchmark running — esc abort" : "benchmark setup — ↑/↓ move · ←/→ change · enter start · esc close"}
      </Text>
      {!s.running ? (
        <>
          <Text>
            {"  prompts: "}
            {SETS.map((st, i) => (
              <Text key={st} color={s.focus === 0 && s.set === st ? "greenBright" : s.set === st ? undefined : "gray"}>
                {s.focus === 0 && s.set === st ? "❯ " : "  "}{SET_LABELS[st] ?? st}{i < SETS.length - 1 ? "  ·  " : ""}
              </Text>
            ))}
          </Text>
          <Text dimColor>  ↳ {SET_EXPLAIN[s.set]}</Text>
          {!coding && (
            <Text color={s.focus === 1 ? "greenBright" : undefined}>
              {"  runs per prompt  "}{s.focus === 1 ? "❯ " : "  "}{s.runs}
              {s.focus !== 1 && <Text dimColor>  (↑/↓ to focus, ←/→ to change)</Text>}
            </Text>
          )}
          <Text dimColor>
            {"  will run: "}
            {props.targets.length > 0 ? props.targets.join(", ") : "(nothing — highlight a config row first)"}
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
