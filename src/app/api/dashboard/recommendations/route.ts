import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import {
  buildOverviewRecommendations,
  collectOverviewRecommendationSignals,
} from '@/lib/dashboard/recommendations';
import { parseOverviewRecommendationConfig } from '@/lib/dashboard/recommendation-settings';
import { SETTING_KEYS } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspacePaths = Array.isArray(body?.workspacePaths)
      ? body.workspacePaths.filter((value: unknown): value is string => typeof value === 'string')
      : [];

    const signals = await collectOverviewRecommendationSignals(workspacePaths);
    const config = parseOverviewRecommendationConfig(getSetting(SETTING_KEYS.OVERVIEW_RECOMMENDATION_RULES));
    const recommendations = buildOverviewRecommendations(signals, config);

    return NextResponse.json({ recommendations, config });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build dashboard recommendations';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
