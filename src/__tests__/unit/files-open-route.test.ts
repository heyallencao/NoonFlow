import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

let openFilePost: typeof import('../../app/api/files/open/route').POST;
let openPathExecutor: typeof import('../../lib/open-path-executor').openPathExecutor;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-open-file-test-'));
type ExecFileCallback = (
  error: childProcess.ExecFileException | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

before(async () => {
  ({ POST: openFilePost } = await import('../../app/api/files/open/route'));
  ({ openPathExecutor } = await import('../../lib/open-path-executor'));
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/files/open', () => {
  it('returns 400 when path is missing', async () => {
    const response = await openFilePost(new Request('http://localhost/api/files/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }) as never);

    assert.equal(response.status, 400);
  });

  it('executes the opener without shell interpolation', async () => {
    const targetPath = path.join(tmpDir, 'semi;colon.txt');
    fs.writeFileSync(targetPath, 'test');

    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const originalExecFile = openPathExecutor.execFile;
    const execFileStub = Object.assign(
      (
        command: string,
        argsOrOptions?: readonly string[] | childProcess.ExecFileOptions | null,
        optionsOrCallback?: childProcess.ExecFileOptions | ExecFileCallback | null,
        maybeCallback?: ExecFileCallback | null,
      ) => {
        const args = Array.isArray(argsOrOptions) ? [...argsOrOptions] : [];
        const callback = typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : typeof maybeCallback === 'function'
            ? maybeCallback
            : null;

        calls.push({ command, args });
        callback?.(null, '', '');
        return { pid: 1 } as never;
      },
      { __promisify__: childProcess.execFile.__promisify__ },
    );
    openPathExecutor.execFile = execFileStub as typeof openPathExecutor.execFile;

    try {
      const response = await openFilePost(new Request('http://localhost/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      }) as never);

      assert.equal(response.status, 200);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0]?.args, [path.resolve(targetPath)]);
    } finally {
      openPathExecutor.execFile = originalExecFile;
    }
  });
});
