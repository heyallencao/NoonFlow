import { NextRequest } from 'next/server';
import { getMediaJob } from '@/lib/db';
import { startJob } from '@/lib/job-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/media/jobs/:id/start — Start executing a job
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getMediaJob(id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'planned' && job.status !== 'paused') {
      return Response.json(
        { error: `Cannot start job from status "${job.status}". Must be "planned" or "paused".` },
        { status: 409 }
      );
    }

    // Start job asynchronously (don't await — it runs in the background)
    startJob(id).catch(err => {
      console.error(`[api/media/jobs/${id}/start] Background execution error:`, err);
    });

    return Response.json({ success: true, jobId: id, status: 'running' });
  } catch (error) {
    console.error('[api/media/jobs/[id]/start] POST failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to start job' },
      { status: 500 }
    );
  }
}
