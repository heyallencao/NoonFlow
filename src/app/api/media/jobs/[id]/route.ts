import { NextRequest } from 'next/server';
import { getMediaJob, getMediaJobItems, deleteMediaJob } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/media/jobs/:id — Get job detail with items
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getMediaJob(id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const items = getMediaJobItems(id);
    return Response.json({ job, items });
  } catch (error) {
    console.error('[api/media/jobs/[id]] GET failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to get job' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/media/jobs/:id — Delete a job
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getMediaJob(id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    // Only allow deleting jobs that are not currently running
    if (job.status === 'running') {
      return Response.json(
        { error: 'Cannot delete a running job. Pause or cancel it first.' },
        { status: 409 }
      );
    }

    deleteMediaJob(id);
    return Response.json({ success: true });
  } catch (error) {
    console.error('[api/media/jobs/[id]] DELETE failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to delete job' },
      { status: 500 }
    );
  }
}
