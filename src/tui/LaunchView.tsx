// Status strip + scrollable raw server output view.
import { Box, Static, Text } from "ink";
import { useEffect, useState } from "react";
import type { RunningServer } from "../server.ts";

export function LaunchView(props: {
  server: RunningServer | undefined;
  error?: string;
}): React.ReactElement {
  const s = props.server;
  return (
    <Box borderStyle="round" borderColor={s ? "green" : "gray"} paddingX={1}>
      {props.error ? (
        <Text color="red">✗ {props.error}</Text>
      ) : s ? (
        <Text>
          <Text color="greenBright" bold>{s.config.name}</Text>{" "}
          pid {s.pid} · {s.url} · up {Math.round((Date.now() - s.startedAt) / 1000)}s · log {s.logFile}
        </Text>
      ) : (
        <Text dimColor>no server running — enter launches selected config</Text>
      )}
    </Box>
  );
}

export function OutputView(props: { server: RunningServer | undefined; scrollRef?: React.MutableRefObject<number> }): React.ReactElement {
  const [, setTick] = useState(0);
  const scrollback = props.scrollRef?.current ?? 0;
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const logs = props.server?.logs ?? [];
  const total = logs.length;
  const visibleCount = 20;
  // Pause on scroll-up: scrollback > 0 freezes the tail.
  const end = Math.max(0, total - scrollback);
  const start = Math.max(0, end - visibleCount);
  const visible = logs.slice(start, end);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        server output {scrollback > 0 ? `(paused, -${scrollback})` : "(live)"} — alt-v back, PgUp/PgDn scroll
      </Text>
      <Box flexDirection="column" marginTop={1} height={visibleCount}>
        {visible.map((l, i) => (
          <Text key={`${start + i}-${i}`} wrap="truncate">{l}</Text>
        ))}
      </Box>
      <Text dimColor>{total} lines buffered</Text>
    </Box>
  );
}

export function outputScrollControls(): { up: number; down: number } {
  return { up: 10, down: -10 };
}

export function StaticHint(): React.ReactElement {
  return <Static items={[1]}>{() => <Text> </Text>}</Static>;
}
