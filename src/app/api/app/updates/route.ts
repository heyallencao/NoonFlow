import { NextResponse } from 'next/server';

const GITHUB_REPO = 'heyallencao/NoonFlow';

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function buildNoUpdatePayload(currentVersion: string) {
  return {
    latestVersion: currentVersion,
    currentVersion,
    updateAvailable: false,
    releaseName: `v${currentVersion}`,
    releaseNotes: '',
    publishedAt: '',
    releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
  };
}

export async function GET() {
  const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'NoonFlow-Update-Checker',
        },
        next: { revalidate: 300 },
      }
    );

    if (!res.ok) {
      return NextResponse.json(buildNoUpdatePayload(currentVersion));
    }

    const release = await res.json();
    const latestVersion = (release.tag_name || '').replace(/^v/, '');

    if (!latestVersion) {
      return NextResponse.json(buildNoUpdatePayload(currentVersion));
    }

    const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;

    return NextResponse.json({
      latestVersion,
      currentVersion,
      updateAvailable,
      releaseName: release.name || `v${latestVersion}`,
      releaseNotes: release.body || '',
      publishedAt: release.published_at || '',
      releaseUrl: release.html_url || `https://github.com/${GITHUB_REPO}/releases`,
    });
  } catch {
    return NextResponse.json(buildNoUpdatePayload(currentVersion));
  }
}
