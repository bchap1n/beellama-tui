// Pinned configs: the `p` key preference, its JSON file, and list ordering.
import { appFile } from "./approot.ts";

export function pinsFile(): string {
  return appFile("pins.json");
}

// Absent or unreadable file means no pins: that is the normal first start.
export async function loadPins(file = pinsFile()): Promise<Set<string>> {
  try {
    const raw: unknown = await Bun.file(file).json();
    return new Set(Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string") : []);
  } catch {
    return new Set();
  }
}

export async function savePins(pins: Set<string>, file = pinsFile()): Promise<void> {
  await Bun.write(file, JSON.stringify([...pins].sort(), null, 2) + "\n");
}

// Pinned rows sit below the rest. sort() is stable, so each group keeps the
// order the caller already applied (filter, sort key).
export function orderPinnedLast<T extends { name: string }>(rows: T[], pins: Set<string>): T[] {
  return [...rows].sort((a, b) => Number(pins.has(a.name)) - Number(pins.has(b.name)));
}
