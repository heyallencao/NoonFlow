import { NextRequest } from 'next/server';
import { getMediaJob, getMediaJobItems } from '@/lib/db';
import { addProgressListener, isJobRunning } from '@/lib/job-executor';
import type { JobProgressEvent } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/media/jobs/:id/progress — SSE real-time progress stream
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getMediaJob(id);
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream may be closed
        }
      };

      // Send current snapshot immediately
      const items = getMediaJobItems(id);
      const snapshot = {
        total: items.length,
        completed: items.filter(i => i.status === 'completed').length,
        failed: items.filter(i => i.status === 'failed').length,
        processing: items.filter(i => i.status === 'processing').length,
      };
      send('snapshot', { jobId: id, status: job.status, progress: snapshot, items });

      // If the job is not running, send done immediately
      if (!isJobRunning(id) && job.status !== 'running') {
        send('done', { jobId: id, status: job.status });
        controller.close();
        return;
      }

      // Register progress listener
      const cleanup = addProgressListener(id, (event: JobProgressEvent) => {
        send(event.type, event);

        // Close stream on terminal events
        if (event.type === 'job_completed' || event.type === 'job_cancelled') {
          send('done', { jobId: id });
          cleanup();
          controller.close();
        }
      });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
          cleanup();
        }
      }, 15000);

      // Cleanup on client disconnect (AbortSignal)
      _request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
