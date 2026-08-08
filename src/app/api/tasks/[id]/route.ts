import { NextRequest, NextResponse } from 'next/server';
import { updateTask, deleteTask, getTask } from '@/lib/db';
import type { TaskResponse, ErrorResponse, UpdateTaskRequest } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body: UpdateTaskRequest = await request.json();
    const existing = getTask(id);

    if (!existing) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    const updated = updateTask(id, body);
    if (!updated) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to update task' },
        { status: 500 }
      );
    }

    return NextResponse.json<TaskResponse>({ task: updated });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to update task' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const deleted = deleteTask(id);
    if (!deleted) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to delete task' },
      { status: 500 }
    );
  }
}
