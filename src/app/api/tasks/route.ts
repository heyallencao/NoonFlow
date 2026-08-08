import { NextRequest, NextResponse } from 'next/server';
import { getTasksBySession, createTask, syncSdkTasks } from '@/lib/db';
import type { TasksResponse, TaskResponse, ErrorResponse, CreateTaskRequest } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing session_id parameter' },
      { status: 400 }
    );
  }

  try {
    const tasks = getTasksBySession(sessionId);
    return NextResponse.json<TasksResponse>({ tasks });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get tasks' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskRequest = await request.json();

    if (!body.session_id || !body.title) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing session_id or title' },
        { status: 400 }
      );
    }

    const task = createTask(body.session_id, body.title, body.description);
    return NextResponse.json<TaskResponse>({ task }, { status: 201 });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}

/** Bulk sync SDK tasks (replace-all for source='sdk') */
export async function PUT(request: NextRequest) {
  try {
    const body: { session_id: string; todos: Array<{ id: string; content: string; status: string; activeForm?: string }> } = await request.json();

    if (!body.session_id || !body.todos) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing session_id or todos' },
        { status: 400 }
      );
    }

    syncSdkTasks(body.session_id, body.todos);
    const tasks = getTasksBySession(body.session_id);
    return NextResponse.json<TasksResponse>({ tasks });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to sync tasks' },
      { status: 500 }
    );
  }
}
