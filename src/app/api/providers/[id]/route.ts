import { NextRequest, NextResponse } from 'next/server';
import { getProvider, updateProvider, deleteProvider } from '@/lib/db';
import type { ProviderResponse, ErrorResponse, UpdateProviderRequest, ApiProvider } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function maskApiKey(provider: ApiProvider): ApiProvider {
  let maskedKey = provider.api_key;
  if (maskedKey && maskedKey.length > 8) {
    maskedKey = '***' + maskedKey.slice(-8);
  }
  return { ...provider, api_key: maskedKey };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ProviderResponse>({ provider: maskApiKey(provider) });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get provider' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body: UpdateProviderRequest = await request.json();

    const existing = getProvider(id);
    if (!existing) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    // Don't update api_key if the client sent back a masked value or left it empty.
    // Empty string means "keep existing" (client intentionally cleared the display field in edit mode).
    if (!body.api_key) {
      delete body.api_key;
    }

    const updated = updateProvider(id, body);
    if (!updated) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to update provider' },
        { status: 500 }
      );
    }

    return NextResponse.json<ProviderResponse>({ provider: maskApiKey(updated) });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to update provider' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const deleted = deleteProvider(id);
    if (!deleted) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to delete provider' },
      { status: 500 }
    );
  }
}
