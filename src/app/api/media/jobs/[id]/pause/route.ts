import { NextRequest } from 'next/server';
import { getMediaJob } from '@/lib/db';
import { pauseJob } from '@/lib/job-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/media/jobs/:id/pause — Pause a running job
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

    if (job.status !== 'running') {
      return Response.json(
        { error: `Cannot pause job with status "${job.status}". Must be "running".` },
        { status: 409 }
      );
    }

    pauseJob(id);
    return Response.json({ success: true, jobId: id, status: 'paused' });
  } catch (error) {
    console.error('[api/media/jobs/[id]/pause] POST failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to pause job' },
      { status: 500 }
    );
  }
}
