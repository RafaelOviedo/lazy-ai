import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requiresShellToSpawn, resolveExecutablePath } from "../src/shared/lib/process/index.ts";

const windowsOnly = { skip: process.platform !== "win32" ? "Windows-only resolution rules" : false };

async function withPath(dir, run) {
  const previousPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    return await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

test("a PATHEXT suffix wins over a same-named extensionless file", windowsOnly, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lazy-ai-which-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Exactly what `npm i -g @openai/codex` leaves behind: a Windows shim next to
  // a `#!/bin/sh` script of the same name. Picking the latter spawns nothing.
  await writeFile(join(dir, "faketool"), "#!/bin/sh\necho hi\n");
  await writeFile(join(dir, "faketool.cmd"), "@echo hi\n");

  const resolved = await withPath(dir, () => resolveExecutablePath("faketool"));

  // PATHEXT supplies the suffix, so its own casing comes through.
  assert.equal(resolved.toLowerCase(), join(dir, "faketool.cmd").toLowerCase());
  assert.equal(requiresShellToSpawn(resolved), true);
});

test("an extensionless file is still found when nothing else matches", windowsOnly, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lazy-ai-which-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  await writeFile(join(dir, "baretool"), "#!/bin/sh\necho hi\n");

  const resolved = await withPath(dir, () => resolveExecutablePath("baretool"));

  assert.equal(resolved, join(dir, "baretool"));
});

test("an absent executable resolves to null", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lazy-ai-which-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.equal(await withPath(dir, () => resolveExecutablePath("missingtool")), null);
});
