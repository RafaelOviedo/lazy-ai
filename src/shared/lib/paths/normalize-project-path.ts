/**
 * Linux filesystems are case-sensitive, so `~/work/Foo` and `~/work/foo` are two
 * different projects. Windows and macOS default to case-insensitive, where the
 * same two paths name one project and must compare equal.
 */
const isCaseInsensitiveFileSystem = process.platform === "win32" || process.platform === "darwin";

/**
 * Normalizes a workspace path for comparison across providers, which record the
 * same directory with different separators, casing, and trailing slashes.
 */
export function normalizeProjectPath(projectPath: string): string {
  const normalized = projectPath.replace(/[\\/]+/g, "/").replace(/\/$/, "");

  return isCaseInsensitiveFileSystem ? normalized.toLowerCase() : normalized;
}

/**
 * Reports whether two paths name the same workspace on this platform.
 */
export function isSameProjectPath(left: string, right: string): boolean {
  return normalizeProjectPath(left) === normalizeProjectPath(right);
}
