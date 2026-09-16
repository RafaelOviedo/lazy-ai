import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

const isWindows = process.platform === "win32";
const defaultWindowsExtensions = ".COM;.EXE;.BAT;.CMD";

/**
 * Finds an executable on PATH the way the shell would.
 *
 * On Windows the bare name is not a file — `codex` is really `codex.EXE` or a
 * `codex.cmd` shim — so every PATHEXT suffix is tried. On POSIX the execute bit
 * is what separates a runnable file from a same-named document.
 *
 * Falls back to a presence-only match when nothing is runnable, so an install
 * with wrong permissions surfaces as a real spawn error rather than silently
 * reading as "not installed".
 */
export async function resolveExecutablePath(binaryName: string): Promise<string | null> {
  return (await findOnPath(binaryName, true)) ?? (await findOnPath(binaryName, false));
}

/**
 * Reports whether an executable for this name exists on PATH.
 */
export async function isExecutableOnPath(binaryName: string): Promise<boolean> {
  return (await resolveExecutablePath(binaryName)) !== null;
}

/**
 * Windows cannot launch `.cmd` / `.bat` shims through CreateProcess, which is
 * what `spawn` uses without a shell. Those have to go through the command
 * interpreter instead.
 */
export function requiresShellToSpawn(executablePath: string): boolean {
  return isWindows && /\.(cmd|bat)$/i.test(executablePath);
}

/**
 * Walks PATH once, either demanding the execute bit or accepting mere presence.
 */
async function findOnPath(binaryName: string, requireExecutable: boolean): Promise<string | null> {
  const searchPath = process.env.PATH ?? "";
  const extensions = isWindows
    ? (process.env.PATHEXT ?? defaultWindowsExtensions).split(";").filter(Boolean)
    : [];

  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    for (const extension of ["", ...extensions]) {
      const candidate = join(directory, `${binaryName}${extension}`);

      if (await isAccessible(candidate, requireExecutable)) return candidate;
    }
  }

  return null;
}

async function isAccessible(path: string, requireExecutable: boolean): Promise<boolean> {
  // X_OK is meaningless on Windows, where PATHEXT already decided runnability.
  const mode = requireExecutable && !isWindows ? constants.X_OK : constants.F_OK;

  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}
