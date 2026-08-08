import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { readLockFile } from "@/lib/skills-lock";
import type { MarketplaceSkill } from "@/types";

const SKILLS_MIRROR_SEARCH_URL = "https://skills.volces.com/api/v1/search";

interface MirrorSkillMetaContent {
  owner?: string | null;
}

interface MirrorSearchResult {
  slug?: string | null;
  displayName?: string | null;
  summary?: string | null;
  metaContent?: MirrorSkillMetaContent | null;
}

interface MirrorSearchResponse {
  results?: MirrorSearchResult[];
  nextMarker?: string | null;
}

function detectInstalledSource(skillName: string): "agents" | "claude" | undefined {
  const agentsDir = path.join(os.homedir(), ".agents", "skills", skillName);
  if (fs.existsSync(agentsDir)) {
    return "agents";
  }

  const claudeDir = path.join(os.homedir(), ".claude", "skills", skillName);
  if (fs.existsSync(claudeDir)) {
    return "claude";
  }

  return undefined;
}

function buildMarketplaceSource(result: MirrorSearchResult): string {
  const owner = (result.metaContent?.owner || "").trim();
  const slug = (result.slug || "").trim();
  if (owner && slug) {
    return `${owner}/${slug}`;
  }
  return slug;
}

function toMarketplaceSkill(result: MirrorSearchResult): MarketplaceSkill | null {
  const source = buildMarketplaceSource(result);
  const skillId = String(result.slug || "").trim();
  const name = String(result.displayName || skillId).trim();

  if (!source || !skillId || !name) {
    return null;
  }

  return {
    id: source,
    skillId,
    name,
    installs: 0,
    source,
  };
}

export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get("q") || "").trim();
    const cursor = (request.nextUrl.searchParams.get("cursor") || "").trim();
    const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : 20;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const searchParams = new URLSearchParams({
        q,
        limit: String(limit),
      });
      if (cursor) {
        searchParams.set("marker", cursor);
      }

      const response = await fetch(`${SKILLS_MIRROR_SEARCH_URL}?${searchParams.toString()}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Skills mirror API returned ${response.status}`);
      }

      const data = await response.json() as MirrorSearchResponse;
      const results = Array.isArray(data.results) ? data.results : [];

      const lockFile = readLockFile();
      const installedBySource = new Map(
        Object.entries(lockFile.skills).map(([skillName, entry]) => [
          entry.source,
          {
            ...entry,
            installedSource: detectInstalledSource(skillName),
          },
        ] as const)
      );
      const installedBySkillId = new Map(
        Object.entries(lockFile.skills).map(([skillName, entry]) => [
          skillName,
          {
            ...entry,
            installedSource: detectInstalledSource(skillName),
          },
        ] as const)
      );

      const skills = results
        .map(toMarketplaceSkill)
        .filter((item): item is MarketplaceSkill => Boolean(item))
        .map((item) => {
          const installedEntry =
            installedBySource.get(item.source) || installedBySkillId.get(item.skillId);
          return {
            ...item,
            isInstalled: Boolean(installedEntry),
            installedAt: installedEntry?.installedAt,
            installedSource: installedEntry?.installedSource,
          };
        });

      return NextResponse.json({
        skills,
        nextCursor: data.nextMarker ?? null,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Skills mirror API request timed out" },
        { status: 504 }
      );
    }
    console.error("[marketplace/search] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 502 }
    );
  }
}
