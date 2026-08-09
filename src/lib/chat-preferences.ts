import type { AssistantRuntime } from '@/types';
import {
  getLocalStorageSafe,
  readCompatibleStorageValue,
  writeStorageValue,
} from '@/lib/browser-storage';

const LAST_MODEL_KEY = 'noonflow:last-model';
const LEGACY_LAST_MODEL_KEYS = ['monolith:last-model'] as const;
const LAST_PROVIDER_ID_KEY = 'noonflow:last-provider-id';
const LEGACY_LAST_PROVIDER_ID_KEYS = ['monolith:last-provider-id'] as const;
const LAST_ASSISTANT_RUNTIME_KEY = 'noonflow:last-assistant-runtime';
const LEGACY_LAST_ASSISTANT_RUNTIME_KEYS = ['monolith:last-assistant-runtime'] as const;

export interface StoredChatPreferences {
  model: string;
  provider_id: string;
  assistant_runtime?: AssistantRuntime;
}

export interface CreateSessionPreferencePayload {
  model?: string;
  provider_id?: string;
  assistant_runtime?: AssistantRuntime;
}

export function getStoredChatPreferences(): StoredChatPreferences {
  if (typeof window === 'undefined') {
    return { model: '', provider_id: '' };
  }

  const storage = getLocalStorageSafe();
  const assistantRuntime = readCompatibleStorageValue(
    storage,
    LAST_ASSISTANT_RUNTIME_KEY,
    LEGACY_LAST_ASSISTANT_RUNTIME_KEYS,
  );
  return {
    model: readCompatibleStorageValue(storage, LAST_MODEL_KEY, LEGACY_LAST_MODEL_KEYS) || '',
    provider_id: readCompatibleStorageValue(
      storage,
      LAST_PROVIDER_ID_KEY,
      LEGACY_LAST_PROVIDER_ID_KEYS,
    ) || '',
    assistant_runtime: assistantRuntime === 'codex' || assistantRuntime === 'pi'
      ? assistantRuntime
      : assistantRuntime === 'claude_code'
      ? 'claude_code'
      : undefined,
  };
}

export function buildCreateSessionPreferencePayload(
  explicitRuntime?: AssistantRuntime,
  preferences: StoredChatPreferences = getStoredChatPreferences(),
): CreateSessionPreferencePayload {
  const { model, provider_id } = preferences;
  const claudePayload = {
    model: model || undefined,
    provider_id: provider_id || undefined,
  };

  if (explicitRuntime === 'codex') {
    return { assistant_runtime: 'codex' };
  }

  if (explicitRuntime === 'pi') {
    return { assistant_runtime: 'pi' };
  }

  if (explicitRuntime === 'claude_code') {
    return {
      assistant_runtime: 'claude_code',
      ...claudePayload,
    };
  }

  return claudePayload;
}

export function setStoredAssistantRuntime(runtime: AssistantRuntime) {
  if (typeof window === 'undefined') {
    return;
  }
  writeStorageValue(getLocalStorageSafe(), LAST_ASSISTANT_RUNTIME_KEY, runtime);
}

export function setStoredClaudePreference(model: string, providerId: string) {
  if (typeof window === 'undefined') {
    return;
  }
  const storage = getLocalStorageSafe();
  writeStorageValue(storage, LAST_MODEL_KEY, model);
  writeStorageValue(storage, LAST_PROVIDER_ID_KEY, providerId);
}
