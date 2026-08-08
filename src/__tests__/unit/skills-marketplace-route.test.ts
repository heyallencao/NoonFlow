import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

type SearchRouteModule = typeof import('../../app/api/skills/marketplace/search/route');
type ReadmeRouteModule = typeof import('../../app/api/skills/marketplace/readme/route');

let searchGet: SearchRouteModule['GET'];
let readmeGet: ReadmeRouteModule['GET'];
const originalFetch = global.fetch;

before(async () => {
  ({ GET: searchGet } = await import('../../app/api/skills/marketplace/search/route'));
  ({ GET: readmeGet } = await import('../../app/api/skills/marketplace/readme/route'));
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('/api/skills/marketplace routes', () => {
  it('search route fetches the Volc mirror search endpoint and maps results', async () => {
    let requestedUrl = '';

    global.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        results: [
          {
            slug: 'tradfri-lights',
            displayName: 'Tradfri Lights',
            metaContent: {
              owner: 'ymebosma',
            },
          },
        ],
        nextMarker: 'next-marker-1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const response = await searchGet(
      new NextRequest('http://localhost/api/skills/marketplace/search?q=tradfri&limit=5&cursor=cursor-1')
    );

    assert.equal(
      requestedUrl,
      'https://skills.volces.com/api/v1/search?q=tradfri&limit=5&marker=cursor-1'
    );
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      skills: Array<{
        source: string;
        skillId: string;
        name: string;
      }>;
      nextCursor: string | null;
    };

    assert.equal(payload.skills.length, 1);
    assert.equal(payload.skills[0]?.source, 'ymebosma/tradfri-lights');
    assert.equal(payload.skills[0]?.skillId, 'tradfri-lights');
    assert.equal(payload.skills[0]?.name, 'Tradfri Lights');
    assert.equal(payload.nextCursor, 'next-marker-1');
  });

  it('readme route fetches the Volc mirror detail endpoint and returns skillMd', async () => {
    let requestedUrl = '';

    global.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        metaContent: {
          skillMd: '# Tradfri Lights',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const response = await readmeGet(
      new NextRequest('http://localhost/api/skills/marketplace/readme?source=ymebosma%2Ftradfri-lights&skillId=tradfri-lights')
    );

    assert.equal(
      requestedUrl,
      'https://skills.volces.com/api/v1/skills/tradfri-lights'
    );
    assert.equal(response.status, 200);

    const payload = await response.json() as {
      content: string | null;
    };
    assert.equal(payload.content, '# Tradfri Lights');
  });

  it('readme cache is scoped by skill slug instead of repo source only', async () => {
    const requestedUrls: string[] = [];

    global.fetch = (async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      const slug = url.split('/').pop();
      return new Response(JSON.stringify({
        metaContent: {
          skillMd: `# ${slug}`,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const responseA = await readmeGet(
      new NextRequest('http://localhost/api/skills/marketplace/readme?source=owner%2Frepo&skillId=skill-a')
    );
    const responseB = await readmeGet(
      new NextRequest('http://localhost/api/skills/marketplace/readme?source=owner%2Frepo&skillId=skill-b')
    );

    const payloadA = await responseA.json() as { content: string | null };
    const payloadB = await responseB.json() as { content: string | null };

    assert.deepEqual(requestedUrls, [
      'https://skills.volces.com/api/v1/skills/skill-a',
      'https://skills.volces.com/api/v1/skills/skill-b',
    ]);
    assert.equal(payloadA.content, '# skill-a');
    assert.equal(payloadB.content, '# skill-b');
  });
});
