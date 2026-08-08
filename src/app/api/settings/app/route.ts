import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import { CLAUDE_AUTH_MODE_KEY, CODEX_AUTH_MODE_KEY } from '@/lib/assistant-auth';
import { SETTING_KEYS } from '@/types';

/**
 * NoonFlow app-level settings (stored in SQLite, separate from ~/.claude/settings.json).
 * Used for API configuration (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, etc.)
 */

const ALLOWED_KEYS = [
  'anthropic_auth_token',
  'anthropic_base_url',
  'dangerously_skip_permissions',
  SETTING_KEYS.DEFAULT_MODEL,
  SETTING_KEYS.CHAT_REASONING_ENABLED,
  SETTING_KEYS.GENERATIVE_UI_ENABLED,
  SETTING_KEYS.WIDGET_TELEMETRY_THRESHOLDS,
  SETTING_KEYS.DEFAULT_ASSISTANT_RUNTIME,
  SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CLAUDE,
  SETTING_KEYS.ASSISTANT_RUNTIME_ENABLED_CODEX,
  CLAUDE_AUTH_MODE_KEY,
  SETTING_KEYS.CODEX_AUTH_TOKEN,
  SETTING_KEYS.CODEX_BASE_URL,
  CODEX_AUTH_MODE_KEY,
  SETTING_KEYS.CODEX_DEFAULT_MODEL,
  SETTING_KEYS.CODEX_EXTRA_ENV,
  SETTING_KEYS.CONTEXT_WINDOW_OVERRIDES,
  SETTING_KEYS.CONTEXT_USAGE_BAR_ENABLED,
  SETTING_KEYS.OVERVIEW_RECOMMENDATION_RULES,
  'locale',
  'ui_font_scale',
];

export async function GET() {
  try {
    const result: Record<string, string> = {};
    for (const key of ALLOWED_KEYS) {
      const value = getSetting(key);
      if (value !== undefined) {
        // Mask token for security (only return last 8 chars)
        if ((key === 'anthropic_auth_token' || key === SETTING_KEYS.CODEX_AUTH_TOKEN) && value.length > 8) {
          result[key] = '***' + value.slice(-8);
        } else {
          result[key] = value;
        }
      }
    }
    return NextResponse.json({ settings: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read app settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 });
    }

    const updatedKeys: string[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      const strValue = String(value ?? '').trim();
      if (strValue) {
        // Don't overwrite token if user sent the masked version back
        if ((key === 'anthropic_auth_token' || key === SETTING_KEYS.CODEX_AUTH_TOKEN) && strValue.startsWith('***')) {
          continue;
        }
        setSetting(key, strValue);
        updatedKeys.push(key);
      } else {
        // Empty value = remove the setting
        setSetting(key, '');
        updatedKeys.push(key);
      }
    }

    if (updatedKeys.length > 0) {
      console.info('[settings/app] updated keys:', updatedKeys.join(', '));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save app settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
