import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

type InstallRouteModule = typeof import("../../app/api/skills/marketplace/install/route");

let installSkill: InstallRouteModule["POST"];
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-skill-install-"));
const tempHome = path.join(tempRoot, "home");
const tempBin = path.join(tempRoot, "bin");
const logFile = path.join(tempRoot, "npx.log");

before(async () => {
  process.env.HOME = tempHome;
  process.env.PATH = `${tempBin}${path.delimiter}${originalPath || ""}`;

  fs.mkdirSync(tempBin, { recursive: true });
  fs.mkdirSync(path.join(tempHome, ".claude", "skills", "tradfri-lights"), { recursive: true });
  fs.writeFileSync(
    path.join(tempBin, process.platform === "win32" ? "npx.cmd" : "npx"),
    process.platform === "win32"
      ? `@echo off\r\necho %* > "${logFile}"\r\n`
      : `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`,
    { mode: 0o755 }
  );

  ({ POST: installSkill } = await import("../../app/api/skills/marketplace/install/route"));
});

after(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("/api/skills/marketplace/install", () => {
  it("allows installing the same skill into the other runtime", async () => {
    const response = await installSkill(new Request("http://localhost/api/skills/marketplace/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "owner/tradfri-lights",
        runtime: "codex",
        global: true,
      }),
    }));

    assert.equal(response.status, 200);
    await response.text();

    const loggedCommand = fs.readFileSync(logFile, "utf-8").trim();
    assert.equal(loggedCommand, "skills add owner/tradfri-lights -y -g --agent codex");
  });

  it("still blocks re-installing into the same runtime", async () => {
    const response = await installSkill(new Request("http://localhost/api/skills/marketplace/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "owner/tradfri-lights",
        runtime: "claude-code",
        global: true,
      }),
    }));

    assert.equal(response.status, 409);
    const payload = await response.json() as { error?: string };
    assert.match(payload.error || "", /already exists/i);
  });
});
