import { open, stat } from "node:fs/promises";

type CachedJsonlFile<T> = {
  /** Distinguishes a replaced file from one that only grew. */
  identity: string;
  /** Items mapped from every newline-terminated line read so far. */
  items: T[];
  /** Lines consumed so far, so line indexes match a full read of the file. */
  lineCount: number;
  /** Byte offset just past the last newline consumed. */
  offset: number;
};

export type JsonlLineMapper<T> = (line: string, lineIndex: number) => T | null;

const defaultMaxCachedFiles = 16;
const newlineByte = 0x0a;

/**
 * Maps the lines of append-only JSONL files to items, reading only the bytes
 * appended since the previous read of the same file.
 *
 * A transcript is polled while its turn runs, and re-reading and re-parsing a
 * long one in full costs hundreds of milliseconds per poll. A file that shrinks
 * or is replaced is read again from the start.
 *
 * The cache is keyed by path, so a file must always be read with the same mapper.
 */
export class IncrementalJsonlReader<T> {
  private readonly files = new Map<string, CachedJsonlFile<T>>();
  private readonly maxCachedFiles: number;

  constructor(maxCachedFiles = defaultMaxCachedFiles) {
    this.maxCachedFiles = maxCachedFiles;
  }

  /**
   * Returns the items for every line currently in the file. Throws when the
   * file cannot be read, like `readFile` would.
   */
  async read(filePath: string, mapLine: JsonlLineMapper<T>): Promise<T[]> {
    try {
      return await this.readCached(filePath, mapLine);
    } catch (error) {
      this.files.delete(filePath);
      throw error;
    }
  }

  private async readCached(filePath: string, mapLine: JsonlLineMapper<T>): Promise<T[]> {
    const fileStats = await stat(filePath);
    const identity = `${fileStats.ino}:${fileStats.birthtimeMs}`;
    const previous = this.files.get(filePath);
    const cached = previous && previous.identity === identity && fileStats.size >= previous.offset
      ? previous
      : { identity, items: [], lineCount: 0, offset: 0 };

    this.touch(filePath, cached);

    if (fileStats.size === cached.offset) return [...cached.items];

    const appended = await this.readBytes(filePath, cached.offset, fileStats.size - cached.offset);
    const lastNewline = appended.lastIndexOf(newlineByte);
    const items = [...cached.items];
    let lineCount = cached.lineCount;

    // The committed offset always sits just past a newline, which never falls
    // inside a multi-byte character, so each chunk decodes on its own.
    if (lastNewline !== -1) {
      for (const line of appended.subarray(0, lastNewline).toString("utf8").split("\n")) {
        const item = mapLine(line, lineCount);

        if (item !== null) items.push(item);
        lineCount += 1;
      }
    }

    const next = { identity, items, lineCount, offset: cached.offset + lastNewline + 1 };

    // An overlapping read of the same file may have committed first; its state
    // covers the same bytes, so either one is safe to keep.
    if (this.files.get(filePath) === cached) {
      this.files.set(filePath, next);
    }

    // A trailing line without a newline may still be mid-write, so it is shown
    // now but parsed again on the next read rather than committed.
    const trailingLine = appended.subarray(lastNewline + 1).toString("utf8");
    const trailingItem = trailingLine ? mapLine(trailingLine, lineCount) : null;

    return trailingItem === null ? items : [...items, trailingItem];
  }

  /**
   * Marks a file as most recently read, evicting the least recently read one
   * once the cache is full.
   */
  private touch(filePath: string, entry: CachedJsonlFile<T>): void {
    this.files.delete(filePath);
    this.files.set(filePath, entry);

    if (this.files.size <= this.maxCachedFiles) return;

    const oldestPath = this.files.keys().next().value;

    if (oldestPath !== undefined) this.files.delete(oldestPath);
  }

  private async readBytes(filePath: string, position: number, length: number): Promise<Buffer> {
    const handle = await open(filePath, "r");

    try {
      const buffer = Buffer.allocUnsafe(length);
      let bytesRead = 0;

      while (bytesRead < length) {
        const result = await handle.read(buffer, bytesRead, length - bytesRead, position + bytesRead);

        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }

      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
