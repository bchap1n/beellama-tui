// Scripts panel: GPU profile actions backed by scheduled tasks.
import { Box, Text } from "ink";
import type { GpuStats } from "./gpu.ts";

export interface ScriptAction {
  id: "apply" | "powerlimit" | "revert" | "install";
  label: string;
  hint: string;
}

export const SCRIPT_ACTIONS: ScriptAction[] = [
  { id: "apply", label: "Apply Anbeeld curve", hint: "1605 MHz @ 0.750 V · 300 W · same as logon" },
  { id: "powerlimit", label: "Apply power limit only", hint: "no V/F curve · yaml power limit" },
  { id: "revert", label: "Revert to baseline", hint: "unlock clock, restore baseline curve, default power" },
  { id: "install", label: "Install scheduled tasks", hint: "elevated · registers tasks, curve runs at logon" },
];

export function Scripts(props: {
  gpu?: GpuStats;
  cursor: number;
  busy: boolean;
  installed?: boolean;
  status?: string;
}): React.ReactElement {
  const gpu = props.gpu;
  const profile = gpu?.powerLimitW !== undefined
    ? `${gpu.powerLimitW} W limit · ${gpu.clockMhz ?? "?"} MHz clock`
    : "GPU state unavailable";
  const tasks = props.installed === undefined ? "" : props.installed ? " · tasks installed" : " · tasks not installed";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">scripts — GPU profile</Text>
      <Text dimColor>{profile}{tasks}</Text>
      {SCRIPT_ACTIONS.map((action, i) => {
        const active = i === props.cursor;
        return (
          <Text key={action.id} color={active ? "black" : undefined} backgroundColor={active ? "cyan" : undefined}>
            {active ? "› " : "  "}{action.label} <Text dimColor>{action.hint}</Text>
          </Text>
        );
      })}
      {props.busy && <Text color="yellow">running…</Text>}
      {props.status && <Text>{props.status}</Text>}
      <Text dimColor>↑/↓ move · enter run · esc close</Text>
    </Box>
  );
}
