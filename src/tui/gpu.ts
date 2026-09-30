// Live GPU util + VRAM probe via nvidia-smi. Never throws; caller throttles.
export interface GpuStats {
  utilPct: number;
  vramUsedMiB: number;
  vramTotalMiB: number;
  powerLimitW?: number;
  clockMhz?: number;
}

export function probeGpu(): GpuStats | undefined {
  try {
    const p = Bun.spawnSync(
      ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,power.limit,clocks.current.graphics", "--format=csv,noheader,nounits"],
      { stdout: "pipe", stderr: "ignore" },
    );
    if (p.exitCode !== 0) return undefined;
    const fields = p.stdout.toString().split(/\r?\n/)[0].split(",").map((f) => Number(f.trim()));
    if (fields.length < 3 || fields.slice(0, 3).some((n) => !Number.isFinite(n))) return undefined;
    return {
      utilPct: fields[0],
      vramUsedMiB: fields[1],
      vramTotalMiB: fields[2],
      powerLimitW: Number.isFinite(fields[3]) ? fields[3] : undefined,
      clockMhz: Number.isFinite(fields[4]) ? fields[4] : undefined,
    };
  } catch {
    return undefined;
  }
}
