import { NextResponse } from 'next/server';
import { getDefaultAssistantRuntime, listAssistantRuntimes } from '@/lib/assistant-runtimes';
import type { AssistantRuntimeListResponse } from '@/types';

export async function GET() {
  try {
    const response: AssistantRuntimeListResponse = {
      runtimes: await listAssistantRuntimes(),
      default_assistant_runtime: getDefaultAssistantRuntime(),
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read assistant runtimes';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
