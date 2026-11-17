// GPU serving profile: apply/revert the undervolt through scheduled tasks.
// The tasks run elevated, so the TUI never needs an admin shell.
import { appFile } from "./approot.ts";

export const APPLY_TASK = "beellama-gpu-undervolt-apply";
export type GpuProfileMode = "apply" | "revert" | "powerlimit";
const RUN_SCRIPT = "gpu-undervolt-tasks-run.ps1";
const INSTALL_SCRIPT = "gpu-undervolt-tasks-install.ps1";

export interface GpuProfileResult {
  ok: boolean;
  message: string;
}

// The scripts print one result line on success and throw a one-line message on
// failure, but PowerShell also appends the throw site and source line. Prefer a
// line that reads like the message itself over the trailing hint text.
function resultLine(out: string, err: string, code: number): string {
  const clean = (text: string) =>
    text.split(/\r?\n/).map((l) => l.replace(/^\s*\|\s?/, "").trim()).filter((l) => l.length > 0);
  if (code === 0) {
    const lines = clean(out);
    return lines[lines.length - 1] ?? "ok";
  }
  const lines = clean(out + "\n" + err);
  return lines.find((l) => /^(Scheduled task|Administrator|nvidia-smi|Task )/.test(l)) ?? `exit ${code}`;
}

export async function taskInstalled(taskName: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["schtasks", "/query", "/tn", taskName], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

export async function runGpuTask(mode: GpuProfileMode): Promise<GpuProfileResult> {
  const args = ["pwsh", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", appFile("scripts", RUN_SCRIPT)];
  if (mode === "revert") args.push("-Revert");
  else if (mode === "powerlimit") args.push("-PowerLimit");
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { ok: code === 0, message: resultLine(out, err, code) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// Open an elevated installer for the tasks. The UAC prompt is the confirmation.
export async function installGpuTasks(): Promise<GpuProfileResult> {
  const script = appFile("scripts", INSTALL_SCRIPT);
  const inner =
    `Start-Process -FilePath 'pwsh' -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script}'`;
  try {
    const proc = Bun.spawn(["pwsh", "-NoProfile", "-Command", inner], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return { ok: true, message: "elevation prompt opened — confirm UAC, then run Apply" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
