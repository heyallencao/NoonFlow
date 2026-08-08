import { NextRequest } from 'next/server';
import { getMediaJob, getMediaJobItems, updateMediaJobItem } from '@/lib/db';
import type { UpdateMediaJobItemsRequest } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PUT /api/media/jobs/:id/items — Batch edit items (during review phase)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getMediaJob(id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'planned' && job.status !== 'draft') {
      return Response.json(
        { error: 'Items can only be edited when job is in planned or draft status' },
        { status: 409 }
      );
    }

    const body: UpdateMediaJobItemsRequest = await request.json();

    for (const itemUpdate of body.items) {
      updateMediaJobItem(itemUpdate.id, {
        prompt: itemUpdate.prompt,
        aspectRatio: itemUpdate.aspectRatio,
        imageSize: itemUpdate.imageSize,
        tags: itemUpdate.tags,
      });
    }

    const items = getMediaJobItems(id);
    return Response.json({ job, items });
  } catch (error) {
    console.error('[api/media/jobs/[id]/items] PUT failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update items' },
      { status: 500 }
    );
  }
}
