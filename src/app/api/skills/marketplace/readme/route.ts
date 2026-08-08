import { NextRequest, NextResponse } from "next/server";

const SKILLS_MIRROR_DETAIL_URL = "https://skills.volces.com/api/v1/skills";
// In-memory cache: source + skill slug → raw skill content
const contentCache = new Map<string, { content: string | null; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface MirrorSkillDetailResponse {
  metaContent?: {
    skillMd?: string | null;
  } | null;
}

function getSkillSlug(source: string, skillId: string): string {
  const normalizedSkillId = skillId.trim();
  if (normalizedSkillId) {
    return normalizedSkillId;
  }

  const normalizedSource = source.trim().replace(/^https?:\/\/[^/]+\//, "");
  const parts = normalizedSource.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

async function fetchSkillContent(
  source: string,
  skillId: string,
  signal: AbortSignal
): Promise<string | null> {
  const slug = getSkillSlug(source, skillId);
  if (!slug) {
    return null;
  }

  const cacheKey = `${source}::${slug}`;
  const cached = contentCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.content;
  }

  const res = await fetch(`${SKILLS_MIRROR_DETAIL_URL}/${encodeURIComponent(slug)}`, {
    signal,
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json() as MirrorSkillDetailResponse;
  const content = typeof data.metaContent?.skillMd === "string"
    ? data.metaContent.skillMd
    : null;

  contentCache.set(cacheKey, { content, ts: Date.now() });
  return content;
}

export async function GET(request: NextRequest) {
  try {
    const source = request.nextUrl.searchParams.get("source") || "";
    const skillId = request.nextUrl.searchParams.get("skillId") || "";

    if (!source || !skillId) {
      return NextResponse.json(
        { error: "source and skillId are required" },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const content = await fetchSkillContent(source, skillId, controller.signal);
      if (!content) {
        return NextResponse.json({ content: null }, { status: 200 });
      }
      return NextResponse.json({ content });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ content: null }, { status: 200 });
    }
    return NextResponse.json({ content: null }, { status: 200 });
  }
}
