import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Finds the package manifest from either the source or the compiled app. */
function readPackageVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url));

  while (true) {
    const manifestPath = join(directory, "package.json");

    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

      if (manifest.name === "@rafaeloviedo/lazyai" && typeof manifest.version === "string") {
        return manifest.version;
      }
    }

    const parent = dirname(directory);
    if (parent === directory) throw new Error("Could not find the LazyAI package version.");
    directory = parent;
  }
}

export const appVersion = readPackageVersion();
