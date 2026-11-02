import type { DiffHunk, FileEdit } from "../../entities/session/index.js";

const beginPatchMarker = "*** Begin Patch";
const endPatchMarker = "*** End Patch";
const fileHeaderPattern = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const moveHeaderPattern = /^\*\*\* Move to: (.+)$/;

/**
 * Finds the patch envelope in whatever text carried it: the raw input of an
 * `apply_patch` call, a shell command, or a code-mode script that quoted it.
 */
export function extractApplyPatch(text: string): string | null {
  const start = text.indexOf(beginPatchMarker);
  const end = start === -1 ? -1 : text.indexOf(endPatchMarker, start);

  if (end === -1) return null;

  const patch = text.slice(start, end + endPatchMarker.length);

  if (patch.includes("\n")) return patch;

  // Quoted inside a script, the newlines are still escape sequences.
  try {
    return JSON.parse(`"${patch}"`) as string;
  } catch {
    return null;
  }
}

/**
 * Reads Codex's `apply_patch` format into file edits. Its hunks carry context
 * lines but no line numbers, so none are reported.
 */
export function parseApplyPatch(patch: string): FileEdit[] {
  const edits: FileEdit[] = [];
  let edit: FileEdit | null = null;
  let hunk: DiffHunk | null = null;

  for (const line of patch.split(/\r?\n/)) {
    const fileHeader = line.match(fileHeaderPattern);

    if (fileHeader) {
      const kind = fileHeader[1] === "Add" ? "create" : fileHeader[1] === "Delete" ? "delete" : "update";

      edit = { path: fileHeader[2].trim(), kind, hunks: [] };
      hunk = null;
      edits.push(edit);
      continue;
    }

    const moveHeader = line.match(moveHeaderPattern);

    if (moveHeader && edit) {
      edit.path = `${edit.path} → ${moveHeader[1].trim()}`;
      continue;
    }

    if (!edit || edit.kind === "delete" || line.startsWith("***")) continue;

    const isChangeLine = line.startsWith("+") || line.startsWith("-") || line.startsWith(" ");

    if (!line.startsWith("@@") && !isChangeLine) continue;

    if (line.startsWith("@@") || !hunk) {
      hunk = { lines: [] };
      edit.hunks.push(hunk);
    }

    if (isChangeLine) hunk.lines.push(line);
  }

  return edits.map((fileEdit) => ({ ...fileEdit, hunks: fileEdit.hunks.filter((fileHunk) => fileHunk.lines.length > 0) }));
}
