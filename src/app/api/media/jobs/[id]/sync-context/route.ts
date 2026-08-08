import { NextRequest } from 'next/server';
import { getMediaJob, getMediaJobItems, addMessage, createContextEvent, markContextEventSynced } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/media/jobs/:id/sync-context — Sync completed results to LLM conversation
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const job = getMediaJob(id);
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const syncMode = body.syncMode || 'manual';

    if (!job.session_id) {
      return Response.json(
        { error: 'Job has no associated session. Cannot sync to conversation.' },
        { status: 400 }
      );
    }

    const items = getMediaJobItems(id);
    const completedItems = items.filter(i => i.status === 'completed');

    if (completedItems.length === 0) {
      return Response.json(
        { error: 'No completed items to sync' },
        { status: 400 }
      );
    }

    // Build summary message
    const lines: string[] = [
      `## Batch Image Generation Complete`,
      ``,
      `**${completedItems.length}/${items.length}** images generated successfully.`,
      ``,
    ];

    for (const item of completedItems) {
      const tags = JSON.parse(item.tags || '[]') as string[];
      const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      lines.push(`- **#${item.idx + 1}**: ${item.prompt.slice(0, 100)}${item.prompt.length > 100 ? '...' : ''}${tagStr}`);
      if (item.result_media_generation_id) {
        lines.push(`  - Generation ID: ${item.result_media_generation_id}`);
      }
    }

    const failedItems = items.filter(i => i.status === 'failed');
    if (failedItems.length > 0) {
      lines.push(``, `**${failedItems.length} items failed:**`);
      for (const item of failedItems) {
        lines.push(`- #${item.idx + 1}: ${item.error || 'Unknown error'}`);
      }
    }

    const summaryText = lines.join('\n');

    // Add as user message to the session
    addMessage(job.session_id, 'user', summaryText);

    // Record context event
    const payload = {
      completedCount: completedItems.length,
      failedCount: failedItems.length,
      totalCount: items.length,
      itemSummaries: completedItems.map(i => ({
        idx: i.idx,
        prompt: i.prompt.slice(0, 200),
        mediaGenerationId: i.result_media_generation_id,
      })),
    };

    const event = createContextEvent({
      sessionId: job.session_id,
      jobId: id,
      payload,
      syncMode,
    });
    markContextEventSynced(event.id);

    return Response.json({ success: true, eventId: event.id, messageLength: summaryText.length });
  } catch (error) {
    console.error('[api/media/jobs/[id]/sync-context] POST failed:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to sync context' },
      { status: 500 }
    );
  }
}
