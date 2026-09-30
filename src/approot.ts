// Resolve files that ship with the app (prompts, scripts) whether running from
// source (`bun run dev`) or a compiled exe. Compiled exes cannot rely on
// import.meta.dir — it may not exist on disk at all.
import { join } from "node:path";

let cached: string | undefined;

export function appRoot(): string {
  if (cached) return cached;
  const candidates = [
    process.cwd(),
    join(import.meta.dir, "..", ".."), // src/bench/* -> repo root (dev)
    join(import.meta.dir, ".."),       // src/* -> repo root (dev)
  ];
  // dist/beellama-tui.exe -> repo root is one level up from the exe.
  const exeDir = process.execPath ? join(process.execPath, "..") : undefined;
  if (exeDir) {
    candidates.push(exeDir, join(exeDir, ".."));
  }
  for (const c of candidates) {
    // A directory containing our marker files counts as the app root.
    for (const marker of ["beellama-tui.yaml", "package.json"]) {
      try {
        const f = Bun.file(join(c, marker));
        if (f.size > 0) {
          cached = c;
          return cached;
        }
      } catch {
        // keep looking
      }
    }
  }
  cached = process.cwd();
  return cached;
}

export function appFile(...segments: string[]): string {
  return join(appRoot(), ...segments);
}

// Expand ${VAR} from the environment plus the built-in ${APP_ROOT}. A missing
// var is a load error, not a silent empty string: a mistyped var name must not
// resolve to a wrong path.
export function expandVars(value: string, where: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    if (name === "APP_ROOT") return appRoot();
    const v = process.env[name];
    if (v === undefined || v === "") throw new Error(`${where}: env var ${name} is not set`);
    return v;
  });
}
