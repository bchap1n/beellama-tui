// Live session stats bar fed by the /metrics poller.
import { Box, Text } from "ink";
import type { SessionStats } from "../types.ts";
import type { GpuStats } from "./gpu.ts";
export function StatsBar(props: { stats: SessionStats | undefined; gpu?: GpuStats }): React.ReactElement {
  const s = props.stats;
  if (!s && !props.gpu) return <Text dimColor> </Text>;
  if (!s) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text color="cyan">
          GPU {props.gpu!.utilPct}% · VRAM {(props.gpu!.vramUsedMiB / 1024).toFixed(1)}/{(props.gpu!.vramTotalMiB / 1024).toFixed(1)} GiB
        </Text>
      </Box>
    );
  }
  const acceptPct = s.specDraftTokens > 0 ? ((s.specAcceptedTokens / s.specDraftTokens) * 100).toFixed(0) : "-";
  const mm = Math.floor(s.elapsedSec / 60);
  const ss = String(s.elapsedSec % 60).padStart(2, "0");
  return (
    <Box borderStyle="round" borderColor="green" paddingX={1} gap={3}>
      <Text color="greenBright">▲ {s.outputTokens.toLocaleString()} out</Text>
      <Text>{s.promptTokens.toLocaleString()} prompt</Text>
      <Text color="yellow">{s.outputTokensPerSec.toFixed(1)} tok/s</Text>
      {props.gpu && (
        <Text color="cyan">
          GPU {props.gpu.utilPct}% · VRAM {(props.gpu.vramUsedMiB / 1024).toFixed(1)}/{(props.gpu.vramTotalMiB / 1024).toFixed(1)} GiB
        </Text>
      )}
      <Text dimColor>spec accept {acceptPct}%</Text>
      <Text dimColor>{mm}:{ss}</Text>
    </Box>
  );
}
