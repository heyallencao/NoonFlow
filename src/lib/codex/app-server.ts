import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type JsonRpcId = number | string;

export interface AppServerNotification {
  method: string;
  params?: Record<string, unknown>;
}

export interface AppServerRequest extends AppServerNotification {
  id: JsonRpcId;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface CodexAppServerOptions {
  executablePath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onNotification: (notification: AppServerNotification) => void | Promise<void>;
  onServerRequest: (request: AppServerRequest) => unknown | Promise<unknown>;
  onFatalError?: (error: Error) => void;
}

const REQUEST_TIMEOUT_MS = 30_000;
const STDERR_LIMIT = 64 * 1024;

function errorMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message?: unknown }).message || 'Unknown app-server error');
  }
  return JSON.stringify(value);
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    child.kill('SIGTERM');
    return;
  }
  try {
    process.kill(-child.pid!, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const timeout = setTimeout(() => {
    if (child.exitCode !== null || child.killed) return;
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 1_500);
  timeout.unref?.();
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private stderrTail = '';
  private requestId = 0;
  private pending = new Map<JsonRpcId, PendingRequest>();
  private stopped = false;
  private fatalError: Error | null = null;

  constructor(private readonly options: CodexAppServerOptions) {}

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.options.executablePath, ['app-server', '--stdio'], {
      cwd: this.options.cwd,
      env: this.options.env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.drainLines();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-STDERR_LIMIT);
    });
    child.once('error', (error) => this.fail(error));
    child.once('close', (code, signal) => {
      if (this.stopped || this.fatalError) return;
      const detail = this.stderrTail.trim();
      this.fail(new Error(
        `Codex app-server exited unexpectedly (code=${code ?? 'unknown'}, signal=${signal ?? 'none'})${detail ? `\n${detail}` : ''}`,
      ));
    });

    await this.request('initialize', {
      clientInfo: { name: 'noonflow', title: 'NoonFlow', version: '0.6.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify('initialized');
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const child = this.child;
    this.child = null;
    if (child) terminate(child);
    this.rejectPending(new Error('Codex app-server stopped'));
  }

  private write(message: unknown): void {
    if (!this.child || this.stopped || this.fatalError || !this.child.stdin.writable) {
      throw this.fatalError ?? new Error('Codex app-server is not running');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private drainLines(): void {
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.fail(new Error(`Codex app-server emitted invalid JSONL: ${line.slice(0, 240)}`));
      return;
    }

    if ('id' in message && typeof message.method !== 'string') {
      const pending = this.pending.get(message.id as JsonRpcId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id as JsonRpcId);
      if (message.error) {
        pending.reject(new Error(`${pending.method} failed: ${errorMessage(message.error)}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== 'string') return;
    const params = message.params && typeof message.params === 'object'
      ? message.params as Record<string, unknown>
      : undefined;
    if ('id' in message) {
      void this.respondToServerRequest({
        id: message.id as JsonRpcId,
        method: message.method,
        params,
      });
      return;
    }
    void Promise.resolve(this.options.onNotification({ method: message.method, params }))
      .catch((error) => this.fail(error instanceof Error ? error : new Error(String(error))));
  }

  private async respondToServerRequest(request: AppServerRequest): Promise<void> {
    try {
      const result = await this.options.onServerRequest(request);
      this.write({ jsonrpc: '2.0', id: request.id, result: result ?? {} });
    } catch (error) {
      this.write({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private fail(error: Error): void {
    if (this.stopped || this.fatalError) return;
    this.fatalError = error;
    if (this.child) terminate(this.child);
    this.rejectPending(error);
    this.options.onFatalError?.(error);
  }
}
