import type { FileEdit } from "../types.js";

/**
 * Counts the lines a file edit adds and removes.
 */
export function countFileEditLines(edit: FileEdit): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const hunk of edit.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) added += 1;
      else if (line.startsWith("-")) removed += 1;
    }
  }

  return { added, removed };
}

/**
 * Names what an edit did in one line, such as "Updated src/a.ts (+3 -1)".
 */
export function describeFileEdit(edit: FileEdit): string {
  if (edit.kind === "delete") return `Deleted ${edit.path}`;

  const { added, removed } = countFileEditLines(edit);

  return `${edit.kind === "create" ? "Created" : "Updated"} ${edit.path} (+${added} -${removed})`;
}
