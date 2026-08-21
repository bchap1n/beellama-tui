// Live session stats bar fed by the /metrics poller.
import { Box, Text } from "ink";
import type { SessionStats } from "../types.ts";

export function StatsBar(props: { stats: SessionStats | undefined }): React.ReactElement {
  const s = props.stats;
  if (!s) return <Text dimColor> </Text>;
  const acceptPct = s.specDraftTokens > 0 ? ((s.specAcceptedTokens / s.specDraftTokens) * 100).toFixed(0) : "-";
  const mm = Math.floor(s.elapsedSec / 60);
  const ss = String(s.elapsedSec % 60).padStart(2, "0");
  return (
    <Box borderStyle="round" borderColor="green" paddingX={1} gap={3}>
      <Text color="greenBright">▲ {s.outputTokens.toLocaleString()} out</Text>
      <Text>{s.promptTokens.toLocaleString()} prompt</Text>
      <Text color="yellow">{s.outputTokensPerSec.toFixed(1)} tok/s</Text>
      <Text dimColor>spec accept {acceptPct}%</Text>
      <Text dimColor>{mm}:{ss}</Text>
    </Box>
  );
}
