import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SETTING_KEYS } from '../../types';

let importVersion = 0;
let testCodexHome: string | null = null;
const ORIGINAL_CODEX_BACKEND = process.env.NOONFLOW_CODEX_BACKEND;
const ORIGINAL_PUBLIC_CODEX_BACKEND = process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

function getTestCodexBinaryPath(): string {
  if (!testCodexHome) {
    testCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-codex-home-'));
  }
  return path.join(testCodexHome, '.local', 'bin', 'codex');
}

async function importFreshCodexClient() {
  const moduleUrl = pathToFileURL(path.resolve('src/lib/codex-client.ts'));
  moduleUrl.searchParams.set('v', String(importVersion += 1));
  return import(moduleUrl.href);
}

async function readStream(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }

  return chunks.join('');
}

function readArgv(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf8').split('\0').filter(Boolean);
}

function readCapturedText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

async function* createThreadEventsStream(
  events: Array<Record<string, unknown>>,
): AsyncGenerator<Record<string, unknown>> {
  for (const event of events) {
    yield event;
  }
}

function resetTestCodexHome(originalHome?: string) {
  if (originalHome) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
}

afterEach(() => {
  if (ORIGINAL_CODEX_BACKEND === undefined) {
    delete process.env.NOONFLOW_CODEX_BACKEND;
  } else {
    process.env.NOONFLOW_CODEX_BACKEND = ORIGINAL_CODEX_BACKEND;
  }

  if (ORIGINAL_PUBLIC_CODEX_BACKEND === undefined) {
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
  } else {
    process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND = ORIGINAL_PUBLIC_CODEX_BACKEND;
  }

  // Reuse the same temporary Codex home across tests so the binary path stays
  // aligned with platform.ts's positive binary lookup cache.
});

describe('Windows Codex SDK executable resolution', () => {
  it('resolves an npm codex.cmd wrapper to the installed x64 native executable', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-codex-win32-x64-'));
    const wrapperPath = path.join(fixtureRoot, 'codex.cmd');
    const codexEntrypoint = path.join(
      fixtureRoot,
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    const platformPackageRoot = path.join(
      fixtureRoot,
      'node_modules',
      '@openai',
      'codex-win32-x64',
    );
    const nativeExecutable = path.join(
      platformPackageRoot,
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe',
    );
    const packageTargetRoot = path.join(
      platformPackageRoot,
      'vendor',
      'x86_64-pc-windows-msvc',
    );
    const codexPathDir = path.join(packageTargetRoot, 'codex-path');

    try {
      fs.mkdirSync(path.dirname(codexEntrypoint), { recursive: true });
      fs.writeFileSync(codexEntrypoint, '#!/usr/bin/env node\n');
      fs.mkdirSync(path.dirname(nativeExecutable), { recursive: true });
      fs.writeFileSync(path.join(platformPackageRoot, 'package.json'), '{}\n');
      fs.writeFileSync(path.join(packageTargetRoot, 'codex-package.json'), '{}\n');
      fs.writeFileSync(nativeExecutable, 'fixture');
      fs.mkdirSync(codexPathDir, { recursive: true });
      fs.writeFileSync(path.join(codexPathDir, 'rg.exe'), 'fixture');
      fs.writeFileSync(
        wrapperPath,
        '@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
      );

      const codexModule = await importFreshCodexClient();
      const launch = codexModule.__resolveCodexSdkLaunchForTests(
        wrapperPath,
        { Path: 'C:\\Windows\\System32', PATH: 'stale-path' },
        'win32',
        'x64',
      );
      assert.equal(
        launch.executablePath,
        fs.realpathSync(nativeExecutable),
      );
      assert.equal(
        launch.env.Path,
        `${fs.realpathSync(codexPathDir)};C:\\Windows\\System32`,
      );
      assert.equal(launch.env.PATH, undefined);
      assert.equal(launch.env.CODEX_MANAGED_PACKAGE_ROOT, fs.realpathSync(path.dirname(path.dirname(codexEntrypoint))));
      assert.equal(launch.env.CODEX_MANAGED_BY_NPM, '1');
      assert.equal(launch.env.CODEX_MANAGED_BY_PNPM, undefined);
      assert.equal(launch.env.CODEX_MANAGED_BY_BUN, undefined);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('resolves the legacy Windows package layout still supported by the Codex SDK', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-codex-win32-legacy-'));
    const wrapperPath = path.join(fixtureRoot, 'codex.cmd');
    const codexEntrypoint = path.join(
      fixtureRoot,
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    const packageTargetRoot = path.join(
      fixtureRoot,
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
    );
    const nativeExecutable = path.join(packageTargetRoot, 'codex', 'codex.exe');
    const codexPathDir = path.join(packageTargetRoot, 'path');

    try {
      fs.mkdirSync(path.dirname(codexEntrypoint), { recursive: true });
      fs.writeFileSync(codexEntrypoint, '#!/usr/bin/env node\n');
      fs.mkdirSync(path.dirname(nativeExecutable), { recursive: true });
      fs.writeFileSync(
        path.join(fixtureRoot, 'node_modules', '@openai', 'codex-win32-x64', 'package.json'),
        '{}\n',
      );
      fs.writeFileSync(nativeExecutable, 'fixture');
      fs.mkdirSync(codexPathDir, { recursive: true });
      fs.writeFileSync(path.join(codexPathDir, 'rg.exe'), 'fixture');
      fs.writeFileSync(
        wrapperPath,
        '@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
      );

      const codexModule = await importFreshCodexClient();
      const launch = codexModule.__resolveCodexSdkLaunchForTests(
        wrapperPath,
        { PATH: 'C:\\Windows\\System32' },
        'win32',
        'x64',
      );

      assert.equal(launch.executablePath, fs.realpathSync(nativeExecutable));
      assert.equal(
        launch.env.PATH,
        `${fs.realpathSync(codexPathDir)};C:\\Windows\\System32`,
      );
      assert.equal(launch.env.CODEX_MANAGED_BY_NPM, '1');
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('fails clearly when a Windows wrapper cannot resolve its native executable', async () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-codex-win32-missing-'));
    const wrapperPath = path.join(fixtureRoot, 'codex.cmd');

    try {
      fs.writeFileSync(
        wrapperPath,
        '@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
      );

      const codexModule = await importFreshCodexClient();
      assert.throws(
        () => codexModule.__resolveCodexSdkLaunchForTests(wrapperPath, {}, 'win32', 'x64'),
        /native Windows executable could not be resolved.*Reinstall Codex/i,
      );
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('passes native Windows executables through unchanged', async () => {
    const codexModule = await importFreshCodexClient();
    const nativeExecutable = 'C:\\Users\\allen\\AppData\\Local\\Codex\\codex.exe';
    const env = { Path: 'C:\\Windows\\System32' };
    const launch = codexModule.__resolveCodexSdkLaunchForTests(
      nativeExecutable,
      env,
      'win32',
      'x64',
    );

    assert.equal(launch.executablePath, nativeExecutable);
    assert.equal(launch.env, env);
  });
});

describe('streamCodex', () => {
  it('rejects ask mode before enabling any Codex tool access', async () => {
    const { streamCodex } = await importFreshCodexClient();

    const payload = await readStream(streamCodex({
      prompt: 'Explain this repository',
      sessionId: 'session-ask-mode',
      permissionMode: 'default',
    }));

    assert.match(payload, /Codex does not support ask mode without tool access/);
    assert.match(payload, /"type":"done"/);
  });

  it('tolerates child process error followed by close without double-closing the stream', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, '#!/definitely/missing/interpreter\n');
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({
        prompt: 'Explain this repository',
        sessionId: 'session-error-close',
      }));

      assert.match(payload, /ENOENT|Failed to start Codex CLI|spawn/i);
      assert.match(payload, /"type":"done"/);
    } finally {
      if (originalHome) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }
    }
  });

  it('routes earlier agent messages to reasoning and keeps the last one as the final answer', async () => {
    const originalHome = process.env.HOME;
    const originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
printf '%s\n' \
'{"type":"thread.started","thread_id":"thread-1"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"✓ 先看入口"}}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ 最终答案"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;
    const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-codex-reasoning-'));
    process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;

    try {
      const db = await import('../../lib/db');
      db.setSetting(SETTING_KEYS.CHAT_REASONING_ENABLED, 'true');
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({
        prompt: 'Explain this repository',
        sessionId: 'session-commentary-routing',
      }));

      assert.match(payload, /"type":"reasoning","data":"✓ 先看入口"/);
      assert.match(payload, /"type":"text","data":"✓ 最终答案"/);
      assert.ok(
        payload.indexOf('"type":"reasoning","data":"✓ 先看入口"')
          < payload.indexOf('"type":"text","data":"✓ 最终答案"')
      );
    } finally {
      const db = await import('../../lib/db');
      db.closeDb();
      fs.rmSync(tempDataDir, { recursive: true, force: true });
      if (originalDataDir === undefined) {
        delete process.env.CLAUDE_GUI_DATA_DIR;
      } else {
        process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
      }
      resetTestCodexHome(originalHome);
    }
  });

  it('uses exec resume and sends only the new turn when sdkSessionId is present', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    const captureArgsPath = path.join(binaryDir, 'resume-args.bin');
    const captureStdinPath = path.join(binaryDir, 'resume-stdin.txt');

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
cat > "${captureStdinPath}"
printf '%s\\0' "$@" > "${captureArgsPath}"
printf '%s\\n' \
'{"type":"thread.started","thread_id":"thread-resume"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ resumed"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({
        prompt: 'Only answer this turn',
        sessionId: 'session-resume',
        sdkSessionId: 'thread-existing',
        systemPrompt: 'System rule',
        files: [{
          id: 'file-1',
          name: 'notes.txt',
          type: 'text/plain',
          size: 4,
          data: '',
          filePath: '/tmp/notes.txt',
        }],
        conversationHistory: [{ role: 'user', content: 'Old context' }],
      }));

      const argv = readArgv(captureArgsPath);
      const promptArg = readCapturedText(captureStdinPath);

      assert.equal(argv[0], 'exec');
      assert.equal(argv[1], '--experimental-json');
      assert.ok(argv.includes('--cd'));
      assert.ok(argv.includes('--skip-git-repo-check'));
      assert.ok(argv.includes('thread-existing'));
      assert.ok(argv.includes('resume'));
      assert.ok(!argv.includes('Only answer this turn'));
      assert.match(payload, /"type":"text","data":"✓ resumed"/);
      assert.match(promptArg, /<attached_files>/);
      assert.match(promptArg, /Only answer this turn/);
      assert.doesNotMatch(promptArg, /<conversation_history>/);
      assert.doesNotMatch(promptArg, /<system_prompt>/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('separates prompt from supported image flags so image attachments do not trigger stdin mode', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    const captureArgsPath = path.join(binaryDir, 'image-args.bin');
    const captureStdinPath = path.join(binaryDir, 'image-stdin.txt');

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
cat > "${captureStdinPath}"
printf '%s\\0' "$@" > "${captureArgsPath}"
printf '%s\\n' \
'{"type":"thread.started","thread_id":"thread-image"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ image ok"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({
        prompt: 'Describe the attached image',
        sessionId: 'session-image',
        files: [{
          id: 'image-1',
          name: 'image.jpg',
          type: 'image/jpeg',
          size: 4,
          data: 'AAAA',
          filePath: '/tmp/image.jpg',
        }],
      }));

      const argv = readArgv(captureArgsPath);
      const promptArg = readCapturedText(captureStdinPath);

      assert.ok(argv.includes('--image'));
      assert.ok(!argv.includes('Describe the attached image'));
      assert.match(promptArg, /Describe the attached image/);
      assert.match(payload, /"type":"text","data":"✓ image ok"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('does not pass unsupported image formats to --image and keeps them as file attachments', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    const captureArgsPath = path.join(binaryDir, 'unsupported-image-args.bin');
    const captureStdinPath = path.join(binaryDir, 'unsupported-image-stdin.txt');

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
cat > "${captureStdinPath}"
printf '%s\\0' "$@" > "${captureArgsPath}"
printf '%s\\n' \
'{"type":"thread.started","thread_id":"thread-unsupported-image"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ unsupported image fallback ok"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({
        prompt: 'Describe the attached image',
        sessionId: 'session-unsupported-image',
        files: [{
          id: 'image-1',
          name: 'image.png',
          type: 'image/png',
          size: 4,
          data: 'AAAA',
          filePath: '/tmp/image.png',
        }],
      }));

      const argv = readArgv(captureArgsPath);
      const promptArg = readCapturedText(captureStdinPath);

      assert.ok(!argv.includes('--image'));
      assert.match(promptArg, /<attached_files>/);
      assert.match(promptArg, /\/tmp\/image\.png/);
      assert.match(payload, /unsupported formats for Codex vision/);
      assert.match(payload, /"type":"text","data":"✓ unsupported image fallback ok"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('falls back to fresh exec with history when resume fails before the turn starts', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    const attemptDir = path.join(binaryDir, 'resume-fallback');
    const countPath = path.join(attemptDir, 'count');

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.mkdirSync(attemptDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
attempt=$(cat "${countPath}" 2>/dev/null || echo 0)
attempt=$((attempt + 1))
echo "$attempt" > "${countPath}"
printf '%s\\0' "$@" > "${attemptDir}/$attempt.bin"
cat > "${attemptDir}/$attempt.stdin"
if [ "$attempt" -eq 1 ]; then
  echo 'resume failed' >&2
  exit 1
fi
printf '%s\\n' \
'{"type":"thread.started","thread_id":"thread-fresh"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ fresh fallback"}}' \
'{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":5}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      let invalidationCalls = 0;
      const payload = await readStream(streamCodex({
        prompt: 'Retry this turn',
        sessionId: 'session-fallback',
        sdkSessionId: 'thread-stale',
        systemPrompt: 'Fresh rules',
        conversationHistory: [{ role: 'assistant', content: 'Prior answer' }],
        onSessionIdInvalidated: () => {
          invalidationCalls += 1;
        },
      }));

      const firstAttemptArgv = readArgv(path.join(attemptDir, '1.bin'));
      const secondAttemptArgv = readArgv(path.join(attemptDir, '2.bin'));
      const firstPromptArg = readCapturedText(path.join(attemptDir, '1.stdin'));
      const secondPromptArg = readCapturedText(path.join(attemptDir, '2.stdin'));

      assert.ok(firstAttemptArgv.includes('resume'));
      assert.doesNotMatch(firstPromptArg, /<conversation_history>/);
      assert.equal(invalidationCalls, 1);
      assert.match(payload, /Session fallback/);
      assert.match(payload, /"type":"text","data":"✓ fresh fallback"/);
      assert.ok(!secondAttemptArgv.includes('resume'));
      assert.match(secondPromptArg, /<conversation_history>/);
      assert.match(secondPromptArg, /<system_prompt>/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('passes model and reasoning effort via --model and --config', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    const capturePath = path.join(binaryDir, 'effort-args.bin');
    process.env.NOONFLOW_CODEX_BACKEND = 'legacy-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
printf '%s\\0' "$@" > "${capturePath}"
printf '%s\\n' \
'{"type":"thread.started","thread_id":"thread-effort"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ effort ok"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      await readStream(streamCodex({
        prompt: 'Use higher effort',
        sessionId: 'session-effort',
        model: 'gpt-5.4-xhigh',
      }));

      const argv = readArgv(capturePath);
      const modelIndex = argv.indexOf('--model');
      const configValues = argv.flatMap((arg, index) => (
        arg === '--config' ? [argv[index + 1]] : []
      ));

      assert.ok(modelIndex >= 0);
      assert.equal(argv[modelIndex + 1], 'gpt-5.4');
      assert.ok(configValues.length > 0);
      assert.ok(configValues.includes('model_reasoning_effort=xhigh'));
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('maps legacy middle suffix to medium reasoning effort config', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    const capturePath = path.join(binaryDir, 'middle-effort-args.bin');
    process.env.NOONFLOW_CODEX_BACKEND = 'legacy-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
printf '%s\\0' "$@" > "${capturePath}"
printf '%s\\n' \
'{"type":"thread.started","thread_id":"thread-middle-effort"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ medium mapped"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      await readStream(streamCodex({
        prompt: 'Use middle effort',
        sessionId: 'session-middle-effort',
        model: 'gpt-5.4-middle',
      }));

      const argv = readArgv(capturePath);
      const configValues = argv.flatMap((arg, index) => (
        arg === '--config' ? [argv[index + 1]] : []
      ));

      assert.ok(configValues.length > 0);
      assert.ok(configValues.includes('model_reasoning_effort=medium'));
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('emits status model with effort suffix for session persistence', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
printf '%s\\n' \
'{"type":"thread.started","thread_id":"thread-effort-status"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ status model"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({
        prompt: 'Verify status model persistence',
        sessionId: 'session-effort-status',
        model: 'gpt-5.4-xhigh',
      }));

      assert.match(payload, /\\"session_id\\":\\"thread-effort-status\\"/);
      assert.match(payload, /\\"model\\":\\"gpt-5\.4-xhigh\\"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('uses sdk-system-cli for long context without passing prompt via argv spawn', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    const spawnMarkerPath = path.join(binaryDir, 'sdk-spawn-marker.txt');
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
    const longPrompt = Array.from(
      { length: 3200 },
      (_, index) => `long prompt segment ${index.toString().padStart(4, '0')}`,
    ).join(' ');
    const longAssistantHistory = Array.from(
      { length: 1800 },
      (_, index) => `assistant history ${index.toString().padStart(4, '0')}`,
    ).join(' ');
    const longUserHistory = Array.from(
      { length: 1800 },
      (_, index) => `user history ${index.toString().padStart(4, '0')}`,
    ).join(' ');

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
echo spawned > "${spawnMarkerPath}"
exit 42
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const codexModule = await importFreshCodexClient();
      const captured: {
        clientOptions?: Record<string, unknown>;
        threadOptions?: Record<string, unknown>;
        input?: unknown;
      } = {};

      class FakeCodex {
        constructor(options?: Record<string, unknown>) {
          captured.clientOptions = options ?? {};
        }

        startThread(options?: Record<string, unknown>) {
          captured.threadOptions = options ?? {};
          return {
            runStreamed: async (input: unknown) => {
              captured.input = input;
              return {
                events: createThreadEventsStream([
                  { type: 'thread.started', thread_id: 'sdk-thread-long-context' },
                  { type: 'turn.started' },
                  {
                    type: 'item.completed',
                    item: {
                      id: 'item_1',
                      details: { type: 'agent_message', text: '✓ sdk long context ok' },
                    },
                  },
                  { type: 'turn.completed', usage: { input_tokens: 11, output_tokens: 13 } },
                ]),
              };
            },
          };
        }

        resumeThread() {
          throw new Error('resume should not be used in this test');
        }
      }

      codexModule.__setCodexCtorForTests(FakeCodex as never);

      const payload = await readStream(codexModule.streamCodex({
        prompt: longPrompt,
        sessionId: 'session-sdk-long-context',
        systemPrompt: 'Keep the response concise.',
        conversationHistory: [
          { role: 'assistant', content: longAssistantHistory },
          { role: 'user', content: longUserHistory },
        ],
      }));

      assert.match(payload, /"type":"text","data":"✓ sdk long context ok"/);
      assert.equal(fs.existsSync(spawnMarkerPath), false);
      assert.equal(captured.clientOptions?.codexPathOverride, binaryPath);
      assert.equal(captured.threadOptions?.skipGitRepoCheck, true);
      assert.equal(typeof captured.input, 'string');
      const inputText = String(captured.input || '');
      assert.match(inputText, /<system_prompt>/);
      assert.match(inputText, /<conversation_history>/);
      assert.match(inputText, /Assistant: assistant history 0000/);
      assert.match(inputText, /User: user history 0000/);
      assert.match(inputText, /long prompt segment 0000/);
      assert.ok(inputText.length > 128 * 1024, `expected long sdk payload, got ${inputText.length}`);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('keeps non-terminal Codex item errors as warnings when the turn completes', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const codexModule = await importFreshCodexClient();

      class FakeCodex {
        startThread() {
          return {
            runStreamed: async () => ({
              events: createThreadEventsStream([
                { type: 'thread.started', thread_id: 'sdk-thread-warning' },
                { type: 'turn.started' },
                {
                  type: 'item.completed',
                  item: {
                    id: 'warning_1',
                    details: {
                      type: 'error',
                      message: 'clamping SessionEnd hook timeout to 3s',
                    },
                  },
                },
                {
                  type: 'item.completed',
                  item: {
                    id: 'item_1',
                    details: { type: 'agent_message', text: 'normal answer' },
                  },
                },
                { type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 3 } },
              ]),
            }),
          };
        }

        resumeThread() {
          throw new Error('resume should not be used in this test');
        }
      }

      codexModule.__setCodexCtorForTests(FakeCodex as never);

      const payload = await readStream(codexModule.streamCodex({
        prompt: 'Return a normal answer',
        sessionId: 'session-sdk-warning',
      }));

      assert.match(payload, /"type":"text","data":"normal answer"/);
      assert.match(payload, /"type":"done"/);
      assert.doesNotMatch(payload, /"type":"error"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('fails when a Codex item error is followed by stream end without turn completion', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const codexModule = await importFreshCodexClient();

      class FakeCodex {
        startThread() {
          return {
            runStreamed: async () => ({
              events: createThreadEventsStream([
                { type: 'thread.started', thread_id: 'sdk-thread-incomplete' },
                { type: 'turn.started' },
                {
                  type: 'item.completed',
                  item: {
                    id: 'error_1',
                    details: { type: 'error', message: 'runtime stopped early' },
                  },
                },
              ]),
            }),
          };
        }

        resumeThread() {
          throw new Error('resume should not be used in this test');
        }
      }

      codexModule.__setCodexCtorForTests(FakeCodex as never);

      const payload = await readStream(codexModule.streamCodex({
        prompt: 'This turn should fail',
        sessionId: 'session-sdk-incomplete',
      }));

      assert.match(payload, /"type":"error","data":"runtime stopped early"/);
      assert.match(payload, /"type":"done"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('falls back from sdk resume to fresh turn when resume fails before events', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const codexModule = await importFreshCodexClient();
      const captured: {
        resumeCalls: number;
        startCalls: number;
        resumeInput?: unknown;
        startInput?: unknown;
      } = {
        resumeCalls: 0,
        startCalls: 0,
      };

      class FakeCodex {
        startThread() {
          captured.startCalls += 1;
          return {
            runStreamed: async (input: unknown) => {
              captured.startInput = input;
              return {
                events: createThreadEventsStream([
                  { type: 'thread.started', thread_id: 'sdk-thread-fresh' },
                  { type: 'turn.started' },
                  {
                    type: 'item.completed',
                    item: {
                      id: 'item_1',
                      details: { type: 'agent_message', text: '✓ sdk fresh fallback' },
                    },
                  },
                  { type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 5 } },
                ]),
              };
            },
          };
        }

        resumeThread() {
          captured.resumeCalls += 1;
          return {
            runStreamed: async (input: unknown) => {
              captured.resumeInput = input;
              throw new Error('resume failed');
            },
          };
        }
      }

      codexModule.__setCodexCtorForTests(FakeCodex as never);

      let invalidationCalls = 0;
      const payload = await readStream(codexModule.streamCodex({
        prompt: 'Retry this turn',
        sessionId: 'session-sdk-fallback',
        sdkSessionId: 'thread-stale',
        systemPrompt: 'Fresh rules',
        conversationHistory: [{ role: 'assistant', content: 'Prior answer' }],
        onSessionIdInvalidated: () => {
          invalidationCalls += 1;
        },
      }));

      assert.equal(captured.resumeCalls, 1);
      assert.equal(captured.startCalls, 1);
      assert.equal(typeof captured.resumeInput, 'string');
      assert.equal(typeof captured.startInput, 'string');
      assert.doesNotMatch(String(captured.resumeInput || ''), /<conversation_history>/);
      assert.match(String(captured.startInput || ''), /<conversation_history>/);
      assert.match(String(captured.startInput || ''), /<system_prompt>/);
      assert.equal(invalidationCalls, 1);
      assert.match(payload, /Session fallback/);
      assert.match(payload, /"type":"text","data":"✓ sdk fresh fallback"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('falls back from sdk resume when the first streamed event is an error event', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const codexModule = await importFreshCodexClient();
      const captured: {
        resumeCalls: number;
        startCalls: number;
      } = {
        resumeCalls: 0,
        startCalls: 0,
      };

      class FakeCodex {
        startThread() {
          captured.startCalls += 1;
          return {
            runStreamed: async () => ({
              events: createThreadEventsStream([
                { type: 'thread.started', thread_id: 'sdk-thread-fresh-after-error' },
                { type: 'turn.started' },
                {
                  type: 'item.completed',
                  item: {
                    id: 'item_1',
                    details: { type: 'agent_message', text: '✓ sdk error-event fallback' },
                  },
                },
                { type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 5 } },
              ]),
            }),
          };
        }

        resumeThread() {
          captured.resumeCalls += 1;
          return {
            runStreamed: async () => ({
              events: createThreadEventsStream([
                { type: 'error', message: 'resume event error' },
              ]),
            }),
          };
        }
      }

      codexModule.__setCodexCtorForTests(FakeCodex as never);

      let invalidationCalls = 0;
      const payload = await readStream(codexModule.streamCodex({
        prompt: 'Retry this turn from error event',
        sessionId: 'session-sdk-error-event-fallback',
        sdkSessionId: 'thread-stale-error-event',
        onSessionIdInvalidated: () => {
          invalidationCalls += 1;
        },
      }));

      assert.equal(captured.resumeCalls, 1);
      assert.equal(captured.startCalls, 1);
      assert.equal(invalidationCalls, 1);
      assert.match(payload, /Session fallback/);
      assert.match(payload, /"type":"text","data":"✓ sdk error-event fallback"/);
      assert.doesNotMatch(payload, /"type":"error","data":"resume event error"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('normalizes the removed sdk-bundled value to sdk-system-cli and passes the external path', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-bundled';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const codexModule = await importFreshCodexClient();
      const captured: {
        clientOptions?: Record<string, unknown>;
        threadOptions?: Record<string, unknown>;
      } = {};

      class FakeCodex {
        constructor(options?: Record<string, unknown>) {
          captured.clientOptions = options ?? {};
        }

        startThread(options?: Record<string, unknown>) {
          captured.threadOptions = options ?? {};
          return {
            runStreamed: async () => ({
              events: createThreadEventsStream([
                { type: 'thread.started', thread_id: 'sdk-thread-system-only' },
                { type: 'turn.started' },
                {
                  type: 'item.completed',
                  item: {
                    id: 'item_1',
                    details: { type: 'agent_message', text: '✓ sdk system-only backend ok' },
                  },
                },
                { type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 4 } },
              ]),
            }),
          };
        }

        resumeThread() {
          throw new Error('resume should not be used in this test');
        }
      }

      codexModule.__setCodexCtorForTests(FakeCodex as never);

      const payload = await readStream(codexModule.streamCodex({
        prompt: 'Use system backend',
        sessionId: 'session-sdk-system-only',
      }));

      assert.match(payload, /"type":"text","data":"✓ sdk system-only backend ok"/);
      assert.equal(captured.clientOptions?.codexPathOverride, binaryPath);
      assert.equal(path.isAbsolute(String(captured.clientOptions?.codexPathOverride)), true);
      assert.equal(captured.threadOptions?.skipGitRepoCheck, true);
      assert.ok(
        captured.threadOptions?.sandboxMode === 'workspace-write'
          || captured.threadOptions?.sandboxMode === 'danger-full-access',
      );
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('keeps the external CLI override when SDK resume falls back to a fresh turn', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-system-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const codexModule = await importFreshCodexClient();
      const captured: {
        clientOptions?: Record<string, unknown>;
        resumeCalls: number;
        startCalls: number;
      } = {
        resumeCalls: 0,
        startCalls: 0,
      };

      class FakeCodex {
        constructor(options?: Record<string, unknown>) {
          captured.clientOptions = options ?? {};
        }

        startThread() {
          captured.startCalls += 1;
          return {
            runStreamed: async () => ({
              events: createThreadEventsStream([
                { type: 'thread.started', thread_id: 'sdk-thread-system-fresh' },
                { type: 'turn.started' },
                {
                  type: 'item.completed',
                  item: {
                    id: 'item_1',
                    details: { type: 'agent_message', text: '✓ sdk system fresh fallback' },
                  },
                },
                { type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 5 } },
              ]),
            }),
          };
        }

        resumeThread() {
          captured.resumeCalls += 1;
          return {
            runStreamed: async () => {
              throw new Error('resume failed');
            },
          };
        }
      }

      codexModule.__setCodexCtorForTests(FakeCodex as never);

      let invalidationCalls = 0;
      const payload = await readStream(codexModule.streamCodex({
        prompt: 'Retry system CLI turn',
        sessionId: 'session-sdk-system-fallback',
        sdkSessionId: 'thread-stale',
        onSessionIdInvalidated: () => {
          invalidationCalls += 1;
        },
      }));

      assert.equal(captured.clientOptions?.codexPathOverride, binaryPath);
      assert.equal(captured.resumeCalls, 1);
      assert.equal(captured.startCalls, 1);
      assert.equal(invalidationCalls, 1);
      assert.match(payload, /Session fallback/);
      assert.match(payload, /"type":"text","data":"✓ sdk system fresh fallback"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('runs the real legacy-cli spawn path with a long prompt and history payload', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    const capturePath = path.join(binaryDir, 'long-context-args.bin');
    process.env.NOONFLOW_CODEX_BACKEND = 'legacy-cli';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
    const longPrompt = Array.from(
      { length: 3200 },
      (_, index) => `long prompt segment ${index.toString().padStart(4, '0')}`,
    ).join(' ');
    const longAssistantHistory = Array.from(
      { length: 1800 },
      (_, index) => `assistant history ${index.toString().padStart(4, '0')}`,
    ).join(' ');
    const longUserHistory = Array.from(
      { length: 1800 },
      (_, index) => `user history ${index.toString().padStart(4, '0')}`,
    ).join(' ');

    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, `#!/bin/sh
printf '%s\\0' "$@" > "${capturePath}"
printf '%s\\n' \
'{"type":"thread.started","thread_id":"thread-long-context"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"✓ long context ok"}}' \
'{"type":"turn.completed","usage":{"input_tokens":11,"output_tokens":13}}'
`);
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({
        prompt: longPrompt,
        sessionId: 'session-long-context',
        systemPrompt: 'Keep the response concise.',
        conversationHistory: [
          { role: 'assistant', content: longAssistantHistory },
          { role: 'user', content: longUserHistory },
        ],
      }));

      const argv = readArgv(capturePath);
      const promptArg = argv.at(-1) || '';

      assert.deepEqual(
        argv.slice(0, 7),
        ['exec', '--color', 'never', '--cd', process.env.HOME!, '--json', '--skip-git-repo-check'],
      );
      assert.match(payload, /"type":"text","data":"✓ long context ok"/);
      assert.match(promptArg, /<system_prompt>/);
      assert.match(promptArg, /<conversation_history>/);
      assert.match(promptArg, /Assistant: assistant history 0000/);
      assert.match(promptArg, /User: user history 0000/);
      assert.match(promptArg, /long prompt segment 0000/);
      assert.ok(promptArg.length > 128 * 1024, `expected long prompt payload, got ${promptArg.length}`);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });

  it('does not let the removed sdk-bundled value bypass a broken system CLI path', async () => {
    const originalHome = process.env.HOME;
    const binaryPath = getTestCodexBinaryPath();
    const binaryDir = path.dirname(binaryPath);
    process.env.NOONFLOW_CODEX_BACKEND = 'sdk-bundled';
    delete process.env.NEXT_PUBLIC_NOONFLOW_CODEX_BACKEND;
    fs.mkdirSync(binaryDir, { recursive: true });
    fs.writeFileSync(binaryPath, '#!/definitely/missing/interpreter\n');
    fs.chmodSync(binaryPath, 0o755);
    process.env.HOME = testCodexHome!;

    try {
      const { streamCodex } = await importFreshCodexClient();
      const payload = await readStream(streamCodex({
        prompt: 'Do not fall back to bundled Codex',
        sessionId: 'session-no-bundled-fallback',
      }));

      assert.match(payload, /ENOENT|Failed to start Codex CLI|spawn/i);
      assert.doesNotMatch(payload, /bundled backend ok/);
      assert.match(payload, /"type":"done"/);
    } finally {
      resetTestCodexHome(originalHome);
    }
  });
});
