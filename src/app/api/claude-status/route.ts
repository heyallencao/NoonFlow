import { NextResponse } from 'next/server';
import { findClaudeBinary, getClaudeVersion } from '@/lib/platform';

export async function GET() {
  try {
    const claudePath = findClaudeBinary();
    if (!claudePath) {
      return NextResponse.json({ connected: false, version: null });
    }
    const version = await getClaudeVersion(claudePath);
    return NextResponse.json({ connected: !!version, version });
  } catch {
    return NextResponse.json({ connected: false, version: null });
  }
}
