import { NextRequest } from 'next/server';
import {
  getAllMediaJobs,
  getMediaJobsBySession,
  createMediaJob,
  createMediaJobItems,
  getMediaJob,
} from '@/lib/db';
import type { CreateMediaJobRequest } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/media/jobs — List all jobs, optionally filtered by sessionId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const jobs = sessionId
      ? getMediaJobsBySession(sessionId)
      : getAllMediaJobs(limit, offset);

    return Response.json({ jobs });
  } catch (error) {
    console.error('[api/media/jobs] GET failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to list jobs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/media/jobs — Create a new job with items (after plan confirmation)
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateMediaJobRequest = await request.json();

    if (!body.items || body.items.length === 0) {
      return Response.json(
        { error: 'At least one item is required' },
        { status: 400 }
      );
    }

    // Create the job
    const job = createMediaJob({
      sessionId: body.sessionId,
      docPaths: body.docPaths,
      stylePrompt: body.stylePrompt,
      batchConfig: body.batchConfig,
      totalItems: body.items.length,
    });

    // Create the items
    const items = createMediaJobItems(job.id, body.items);

    return Response.json({ job: getMediaJob(job.id), items });
  } catch (error) {
    console.error('[api/media/jobs] POST failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to create job' },
      { status: 500 }
    );
  }
}
