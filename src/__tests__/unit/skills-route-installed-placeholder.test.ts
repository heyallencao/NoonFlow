import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";

type SkillsRouteModule = typeof import("../../app/api/skills/route");

let getSkills: SkillsRouteModule["GET"];
const originalHome = process.env.HOME;
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "monolith-skills-home-"));

before(async () => {
  process.env.HOME = tempHome;

  const claudeSkillDir = path.join(tempHome, ".claude", "skills", "tradfri-lights");
  fs.mkdirSync(claudeSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeSkillDir, "config.json"),
    JSON.stringify({ host: "gateway.local" }, null, 2),
    "utf-8"
  );

  const agentsDir = path.join(tempHome, ".agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, ".skill-lock.json"),
    JSON.stringify(
      {
        version: 3,
        skills: {
          "tradfri-lights": {
            source: "ymebosma/tradfri-lights",
            sourceType: "github",
            sourceUrl: "https://github.com/ymebosma/tradfri-lights.git",
            skillFolderHash: "661f785ac98a3b4c2b3485687089f95886b817f8",
            installedAt: "2026-04-04T14:40:01.581Z",
            updatedAt: "2026-04-04T14:40:01.581Z",
          },
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  ({ GET: getSkills } = await import("../../app/api/skills/route"));
});

after(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe("/api/skills installed placeholders", () => {
  it("includes installed skills that exist on disk without a root SKILL.md", async () => {
    const response = await getSkills(new NextRequest("http://localhost/api/skills"));
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      skills: Array<{
        name: string;
        source: string;
        installedSource?: "agents" | "claude";
        description: string;
        filePath: string;
        content: string;
        runtimeAvailability?: Array<"claude" | "codex" | "pi">;
      }>;
    };

    const installedSkill = payload.skills.find((skill) => skill.name === "tradfri-lights");
    assert.ok(installedSkill);
    assert.equal(installedSkill?.source, "installed");
    assert.equal(installedSkill?.installedSource, "claude");
    assert.equal(installedSkill?.filePath, path.join(tempHome, ".claude", "skills", "tradfri-lights"));
    assert.match(installedSkill?.description || "", /ymebosma\/tradfri-lights/);
    assert.match(installedSkill?.content || "", /does not include a root `SKILL\.md`/);
    assert.deepEqual(installedSkill?.runtimeAvailability, ["claude"]);
  });
});
