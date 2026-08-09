import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

type SkillsRouteModule = typeof import('../../app/api/skills/route');
type SkillDetailRouteModule = typeof import('../../app/api/skills/[name]/route');

let createSkill: SkillsRouteModule['POST'];
let getSkills: SkillsRouteModule['GET'];
let getSkill: SkillDetailRouteModule['GET'];
let updateSkill: SkillDetailRouteModule['PUT'];
let deleteSkill: SkillDetailRouteModule['DELETE'];
const originalHome = process.env.HOME;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noonflow-skill-create-runtime-'));
const tempHome = path.join(tempRoot, 'home');
const workspace = path.join(tempRoot, 'workspace');

before(async () => {
  process.env.HOME = tempHome;
  fs.mkdirSync(workspace, { recursive: true });
  ({ POST: createSkill, GET: getSkills } = await import('../../app/api/skills/route'));
  ({ GET: getSkill, PUT: updateSkill, DELETE: deleteSkill } = await import('../../app/api/skills/[name]/route'));
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('/api/skills runtime-targeted creation', () => {
  it('creates global Pi skills in the shared Codex/Pi agents directory', async () => {
    const content = '---\ndescription: Shared skill\n---\n# Shared';
    const response = await createSkill(new Request('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'shared-skill', scope: 'global', runtime: 'pi', content }),
    }));

    assert.equal(response.status, 201);
    const expectedPath = path.join(tempHome, '.agents', 'skills', 'shared-skill', 'SKILL.md');
    assert.equal(fs.readFileSync(expectedPath, 'utf8'), content);
    const payload = await response.json();
    assert.equal(payload.skill.skillTarget, 'agents');
    assert.deepEqual(payload.skill.runtimeAvailability, ['codex', 'pi']);

    const listResponse = await getSkills(new NextRequest('http://localhost/api/skills'));
    const listPayload = await listResponse.json() as { skills: Array<{ name: string; source: string; runtimeAvailability?: string[] }> };
    const created = listPayload.skills.find((skill) => skill.name === 'shared-skill');
    assert.equal(created?.source, 'global');
    assert.deepEqual(created?.runtimeAvailability, ['codex', 'pi']);

    const projectCollisionContent = '---\ndescription: Project collision\n---\n# Project Collision';
    const projectCollisionResponse = await createSkill(new Request('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'shared-skill',
        scope: 'project',
        runtime: 'pi',
        cwd: workspace,
        content: projectCollisionContent,
      }),
    }));
    assert.equal(projectCollisionResponse.status, 201);
    const projectCollisionPath = path.join(workspace, '.agents', 'skills', 'shared-skill', 'SKILL.md');

    const detailContext = { params: Promise.resolve({ name: 'shared-skill' }) };
    const detailResponse = await getSkill(
      new Request('http://localhost/api/skills/shared-skill?target=agents&scope=global'),
      detailContext,
    );
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json();
    assert.equal(detailPayload.skill.content, content);

    const updatedContent = '---\ndescription: Updated shared skill\n---\n# Updated Shared';
    const updateResponse = await updateSkill(
      new Request('http://localhost/api/skills/shared-skill?target=agents&scope=global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updatedContent }),
      }),
      detailContext,
    );
    assert.equal(updateResponse.status, 200);
    assert.equal(fs.readFileSync(expectedPath, 'utf8'), updatedContent);
    assert.equal(fs.readFileSync(projectCollisionPath, 'utf8'), projectCollisionContent);

    const deleteResponse = await deleteSkill(
      new Request('http://localhost/api/skills/shared-skill?target=agents&scope=global', { method: 'DELETE' }),
      detailContext,
    );
    assert.equal(deleteResponse.status, 200);
    assert.equal(fs.existsSync(expectedPath), false);
    assert.equal(fs.existsSync(path.dirname(expectedPath)), false);
    assert.equal(fs.readFileSync(projectCollisionPath, 'utf8'), projectCollisionContent);
  });

  it('creates and lists project Pi skills in the workspace agents directory', async () => {
    const content = '---\ndescription: Project shared skill\n---\n# Project Shared';
    const response = await createSkill(new Request('http://localhost/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'project-shared', scope: 'project', runtime: 'codex', cwd: workspace, content }),
    }));

    assert.equal(response.status, 201);
    const expectedPath = path.join(workspace, '.agents', 'skills', 'project-shared', 'SKILL.md');
    assert.equal(fs.readFileSync(expectedPath, 'utf8'), content);

    const listResponse = await getSkills(new NextRequest(`http://localhost/api/skills?cwd=${encodeURIComponent(workspace)}`));
    const listPayload = await listResponse.json() as { skills: Array<{ name: string; source: string; runtimeAvailability?: string[] }> };
    const created = listPayload.skills.find((skill) => skill.name === 'project-shared');
    assert.equal(created?.source, 'project');
    assert.deepEqual(created?.runtimeAvailability, ['codex', 'pi']);
  });

  it('lists and manages native Pi skills without confusing global and project copies', async () => {
    const globalPath = path.join(tempHome, '.pi', 'agent', 'skills', 'global-folder', 'SKILL.md');
    const projectPath = path.join(workspace, '.pi', 'skills', 'project-folder', 'SKILL.md');
    const globalContent = '---\nname: native-pi\ndescription: Global native Pi\n---\n# Global';
    const projectContent = '---\nname: native-pi\ndescription: Project native Pi\n---\n# Project';
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(globalPath, globalContent);
    fs.writeFileSync(projectPath, projectContent);

    const listResponse = await getSkills(new NextRequest(`http://localhost/api/skills?cwd=${encodeURIComponent(workspace)}`));
    const listPayload = await listResponse.json() as {
      skills: Array<{ name: string; source: string; skillTarget?: string; runtimeAvailability?: string[] }>;
    };
    const nativePiSkills = listPayload.skills.filter((skill) => skill.name === 'native-pi');
    assert.equal(nativePiSkills.length, 2);
    assert.deepEqual(nativePiSkills.map((skill) => skill.source).sort(), ['global', 'project']);
    assert.ok(nativePiSkills.every((skill) => skill.skillTarget === 'pi'));
    assert.ok(nativePiSkills.every((skill) => JSON.stringify(skill.runtimeAvailability) === JSON.stringify(['pi'])));

    const detailContext = { params: Promise.resolve({ name: 'native-pi' }) };
    const globalDetail = await getSkill(
      new Request(`http://localhost/api/skills/native-pi?target=pi&scope=global&cwd=${encodeURIComponent(workspace)}`),
      detailContext,
    );
    assert.equal(globalDetail.status, 200);
    assert.equal((await globalDetail.json()).skill.content, globalContent);

    const updatedContent = '---\nname: native-pi\ndescription: Updated global Pi\n---\n# Updated';
    const updateResponse = await updateSkill(
      new Request(`http://localhost/api/skills/native-pi?target=pi&scope=global&cwd=${encodeURIComponent(workspace)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: updatedContent }),
      }),
      detailContext,
    );
    assert.equal(updateResponse.status, 200);
    assert.equal(fs.readFileSync(globalPath, 'utf8'), updatedContent);
    assert.equal(fs.readFileSync(projectPath, 'utf8'), projectContent);

    const deleteResponse = await deleteSkill(
      new Request(`http://localhost/api/skills/native-pi?target=pi&scope=global&cwd=${encodeURIComponent(workspace)}`, { method: 'DELETE' }),
      detailContext,
    );
    assert.equal(deleteResponse.status, 200);
    assert.equal(fs.existsSync(globalPath), false);
    assert.equal(fs.readFileSync(projectPath, 'utf8'), projectContent);
  });
});
