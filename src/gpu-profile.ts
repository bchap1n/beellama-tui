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

// The apply task runs the Anbeeld curve (power limit plus a V/F cap). nvidia-smi
// cannot set voltage, so the direct fallback cannot reproduce it. Run the curve
// script itself instead; it guards on elevation itself. Fail closed rather than
// landing on a power-limit-only profile the task would never produce.
const LOGON_SCRIPT = "gpu-undervolt-curve-1605-750.ps1";

// Called once when the TUI starts. Prefer the scheduled task; fall back to the
// curve script so an elevated TUI keeps working without installed tasks.
export async function applyGpuProfile(): Promise<GpuProfileResult> {
  const viaTask = await runGpuTask("apply");
  if (viaTask.ok) return viaTask;
  return runCurveScriptFallback(viaTask);
}

async function runCurveScriptFallback(viaTask: GpuProfileResult): Promise<GpuProfileResult> {
  const script = appFile("scripts", LOGON_SCRIPT);
  try {
    const proc = Bun.spawn(
      ["pwsh", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (code === 0) return { ok: true, message: resultLine(out, err, code) };
    // Keep the task failure visible: an unused appCfg would hide why the task path failed.
    return { ok: false, message: `${resultLine(out, err, code)} (task path: ${viaTask.message})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
