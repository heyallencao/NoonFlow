import { NextRequest } from 'next/server';
import { getMediaJob } from '@/lib/db';
import { startJob } from '@/lib/job-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/media/jobs/:id/resume — Resume a paused job
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

    if (job.status !== 'paused') {
      return Response.json(
        { error: `Cannot resume job with status "${job.status}". Must be "paused".` },
        { status: 409 }
      );
    }

    // Resume by calling startJob (which handles paused → running)
    startJob(id).catch(err => {
      console.error(`[api/media/jobs/${id}/resume] Background execution error:`, err);
    });

    return Response.json({ success: true, jobId: id, status: 'running' });
  } catch (error) {
    console.error('[api/media/jobs/[id]/resume] POST failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to resume job' },
      { status: 500 }
    );
  }
}
