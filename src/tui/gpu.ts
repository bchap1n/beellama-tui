// Live GPU util + VRAM probe via nvidia-smi. Never throws; caller throttles.
export interface GpuStats { utilPct: number; vramUsedMiB: number; vramTotalMiB: number }

export function probeGpu(): GpuStats | undefined {
  try {
    const p = Bun.spawnSync(
      ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
      { stdout: "pipe", stderr: "ignore" },
    );
    if (p.exitCode !== 0) return undefined;
    const fields = p.stdout.toString().split(/\r?\n/)[0].split(",").map((f) => Number(f.trim()));
    if (fields.length < 3 || fields.some((n) => !Number.isFinite(n))) return undefined;
    return { utilPct: fields[0], vramUsedMiB: fields[1], vramTotalMiB: fields[2] };
  } catch {
    return undefined;
  }
}
