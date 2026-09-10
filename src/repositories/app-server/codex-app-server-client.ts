import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

type JsonRpcRequest = {
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

type PendingRequest = {
  method: string;
  reject(error: Error): void;
  resolve(value: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

export type CodexAppServerResumeResult = {
  threadId: string;
};

export type CodexAppServerDeleteResult = {
  threadId: string;
};

export class CodexAppServerActiveWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAppServerActiveWriterError";
  }
}

export function isCodexAppServerActiveWriterError(error: unknown): error is CodexAppServerActiveWriterError {
  return error instanceof CodexAppServerActiveWriterError;
}

type ThreadResumeResponse = {
  thread?: {
    id?: string;
    sessionId?: string;
  };
};

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: ReadlineInterface | null = null;
  private initializePromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private stderrLines: string[] = [];

  async resumeThread(threadId: string, cwd?: string): Promise<CodexAppServerResumeResult> {
    await this.initialize();

    const result = await this.request<ThreadResumeResponse>("thread/resume", {
      threadId,
      cwd,
      serviceName: "lazy-ai",
    });

    return {
      threadId: result.thread?.sessionId ?? result.thread?.id ?? threadId,
    };
  }

  async deleteThread(threadId: string): Promise<CodexAppServerDeleteResult> {
    await this.initialize();

    await this.request<Record<string, never>>("thread/delete", {
      threadId,
    });

    return {
      threadId,
    };
  }

  dispose(): void {
    this.rejectPendingRequests(new Error("Codex app-server client disposed."));

    this.stdoutReader?.close();
    this.stdoutReader = null;

    if (this.process && !this.process.killed) {
      this.process.kill();
    }

    this.process = null;
    this.initializePromise = null;
  }

  private initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeProcess().catch((error: unknown) => {
        this.initializePromise = null;
        throw error;
      });
    }

    return this.initializePromise;
  }

  private async initializeProcess(): Promise<void> {
    this.startProcess();

    await this.request("initialize", {
      clientInfo: {
        name: "lazy-ai",
        title: "Lazy AI",
        version: "0.0.1",
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    this.notify({
      method: "initialized",
      params: {},
    });
  }

  private startProcess(): void {
    if (this.process && !this.process.killed) return;

    const appServerProcess = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process = appServerProcess;
    this.stderrLines = [];

    this.stdoutReader = createInterface({
      input: appServerProcess.stdout,
    });

    this.stdoutReader.on("line", (line) => this.handleStdoutLine(line));
    appServerProcess.stderr.on("data", (chunk: Buffer) => this.recordStderr(chunk));
    appServerProcess.on("error", (error) => this.handleProcessError(error));
    appServerProcess.on("exit", (code, signal) => this.handleProcessExit(code, signal));
  }

  private request<T>(method: string, params?: unknown, timeoutMs = 15000): Promise<T> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Codex app-server request "${method}" timed out.`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        method,
        reject,
        resolve: (value) => resolve(value as T),
        timer,
      });

      try {
        this.send({
          id: requestId,
          method,
          params,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(notification: JsonRpcNotification): void {
    this.send(notification);
  }

  private send(message: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.process?.stdin.writable) {
      throw new Error("Codex app-server is not available.");
    }

    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdoutLine(line: string): void {
    let message: JsonRpcResponse;

    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }

    if (typeof message.id !== "number") return;

    const pendingRequest = this.pendingRequests.get(message.id);

    if (!pendingRequest) return;

    clearTimeout(pendingRequest.timer);
    this.pendingRequests.delete(message.id);

    if (message.error) {
      const responseError = this.formatResponseError(pendingRequest.method, message.error);

      if (this.isActiveWriterError(message.error)) {
        pendingRequest.reject(new CodexAppServerActiveWriterError(responseError));
        return;
      }

      pendingRequest.reject(new Error(responseError));
      return;
    }

    pendingRequest.resolve(message.result);
  }

  private recordStderr(chunk: Buffer): void {
    const lines = chunk.toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    this.stderrLines.push(...lines);
    this.stderrLines = this.stderrLines.slice(-8);
  }

  private handleProcessError(error: Error): void {
    this.rejectPendingRequests(new Error(`Codex app-server failed to start: ${error.message}`));
    this.initializePromise = null;
    this.process = null;
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    const stderr = this.stderrLines.length > 0 ? ` ${this.stderrLines.join(" ")}` : "";
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;

    this.rejectPendingRequests(new Error(`Codex app-server exited with ${reason}.${stderr}`));
    this.initializePromise = null;
    this.process = null;
    this.stdoutReader = null;
  }

  private rejectPendingRequests(error: Error): void {
    for (const pendingRequest of this.pendingRequests.values()) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(error);
    }

    this.pendingRequests.clear();
  }

  private formatResponseError(method: string, error: NonNullable<JsonRpcResponse["error"]>): string {
    const code = typeof error.code === "number" ? ` (${error.code})` : "";
    const message = error.message ?? "Unknown error";

    return `Codex app-server request "${method}" failed${code}: ${message}`;
  }

  private isActiveWriterError(error: NonNullable<JsonRpcResponse["error"]>): boolean {
    return error.message?.includes("already has an active writer") ?? false;
  }
}
