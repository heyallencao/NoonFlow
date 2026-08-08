import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

type SkillDetailRouteModule = typeof import("../../app/api/skills/[name]/route");

let deleteSkill: SkillDetailRouteModule["DELETE"];
const originalHome = process.env.HOME;
const originalPath = process.env.PATH;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-skill-delete-"));
const tempHome = path.join(tempRoot, "home");
const tempBin = path.join(tempRoot, "bin");
const logFile = path.join(tempRoot, "npx.log");

before(async () => {
  process.env.HOME = tempHome;
  process.env.PATH = `${tempBin}${path.delimiter}${originalPath || ""}`;

  fs.mkdirSync(tempBin, { recursive: true });
  fs.mkdirSync(path.join(tempHome, ".claude", "skills", "tradfri-lights"), { recursive: true });
  fs.writeFileSync(
    path.join(tempHome, ".claude", "skills", "tradfri-lights", "config.json"),
    "{}",
    "utf-8"
  );

  fs.writeFileSync(
    path.join(tempBin, "npx"),
    `#!/bin/sh\necho "$@" > "${logFile}"\nexit 0\n`,
    { mode: 0o755 }
  );

  ({ DELETE: deleteSkill } = await import("../../app/api/skills/[name]/route"));
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

describe("/api/skills/[name] installed delete", () => {
  it("uninstalls directory-only installed skills through the skills CLI", async () => {
    const response = await deleteSkill(
      new Request("http://localhost/api/skills/tradfri-lights?source=claude"),
      { params: Promise.resolve({ name: "tradfri-lights" }) }
    );

    assert.equal(response.status, 200);
    const payload = await response.json() as { success: boolean };
    assert.equal(payload.success, true);

    const loggedCommand = fs.readFileSync(logFile, "utf-8").trim();
    assert.equal(loggedCommand, "skills remove tradfri-lights -g -y --agent claude-code");
  });

  it("uses the installed directory id instead of the front-matter display name when uninstalling", async () => {
    const skillRoot = path.join(tempHome, ".claude", "skills", "actual-skill-id");
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, "SKILL.md"),
      [
        "---",
        'name: "Friendly Skill Name"',
        "---",
        "",
        "# Friendly Skill Name",
      ].join("\n"),
      "utf-8"
    );

    const response = await deleteSkill(
      new Request("http://localhost/api/skills/Friendly%20Skill%20Name?source=claude"),
      { params: Promise.resolve({ name: "Friendly Skill Name" }) }
    );

    assert.equal(response.status, 200);
    const loggedCommand = fs.readFileSync(logFile, "utf-8").trim();
    assert.equal(loggedCommand, "skills remove actual-skill-id -g -y --agent claude-code");
  });
});
