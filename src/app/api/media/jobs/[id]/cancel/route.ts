import { NextRequest } from 'next/server';
import { getMediaJob } from '@/lib/db';
import { cancelJob } from '@/lib/job-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/media/jobs/:id/cancel — Cancel a running or paused job
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

    if (job.status !== 'running' && job.status !== 'paused' && job.status !== 'planned') {
      return Response.json(
        { error: `Cannot cancel job with status "${job.status}".` },
        { status: 409 }
      );
    }

    cancelJob(id);
    return Response.json({ success: true, jobId: id, status: 'cancelled' });
  } catch (error) {
    console.error('[api/media/jobs/[id]/cancel] POST failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel job' },
      { status: 500 }
    );
  }
}
