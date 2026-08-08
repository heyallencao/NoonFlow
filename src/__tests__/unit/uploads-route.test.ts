import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const originalHome = process.env.HOME;
const tempHomes: string[] = [];

/* eslint-disable @typescript-eslint/no-require-imports */
const route = require('../../app/api/uploads/route') as typeof import('../../app/api/uploads/route');

function createTempHome(): string {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monolith-uploads-route-home-'));
  tempHomes.push(homeDir);
  process.env.HOME = homeDir;
  return homeDir;
}

afterEach(() => {
  if (originalHome) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
});

after(() => {
  for (const homeDir of tempHomes) {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

describe('/api/uploads', () => {
  it('serves files from the upload_files/project layout', async () => {
    const homeDir = createTempHome();
    const filePath = path.join(homeDir, '.monolith', 'upload_files', 'demo_abcd1234', 'hello.txt');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'hello from upload_files', 'utf8');

    const response = await route.GET(new NextRequest(`http://localhost/api/uploads?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'hello from upload_files');
    assert.equal(response.headers.get('Content-Type'), 'text/plain');
  });

  it('still serves files from the older project/upload layout', async () => {
    const homeDir = createTempHome();
    const filePath = path.join(homeDir, '.monolith', 'demo_abcd1234', 'upload', 'hello.txt');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'hello from upload', 'utf8');

    const response = await route.GET(new NextRequest(`http://localhost/api/uploads?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'hello from upload');
  });

  it('rejects files outside managed upload directories', async () => {
    const homeDir = createTempHome();
    const filePath = path.join(homeDir, 'notes.txt');
    fs.writeFileSync(filePath, 'not an upload', 'utf8');

    const response = await route.GET(new NextRequest(`http://localhost/api/uploads?path=${encodeURIComponent(filePath)}`));

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Access denied' });
  });
});
