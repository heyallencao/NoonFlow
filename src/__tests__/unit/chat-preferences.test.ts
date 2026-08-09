import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

let getStoredChatPreferences: typeof import('../../lib/chat-preferences').getStoredChatPreferences;
let buildCreateSessionPreferencePayload: typeof import('../../lib/chat-preferences').buildCreateSessionPreferencePayload;

interface MemoryStorageState {
  store: Map<string, string>;
}

function createMemoryStorage(): Storage & MemoryStorageState {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

const globalObject = globalThis as typeof globalThis & {
  localStorage?: Storage;
  window?: typeof globalThis;
};

const originalLocalStorage = globalObject.localStorage;
const originalWindow = globalObject.window;

before(async () => {
  ({ getStoredChatPreferences, buildCreateSessionPreferencePayload } = await import('../../lib/chat-preferences'));
});

afterEach(() => {
  if (originalLocalStorage) {
    globalObject.localStorage = originalLocalStorage;
  } else {
    Reflect.deleteProperty(globalObject, 'localStorage');
  }

  if (originalWindow) {
    globalObject.window = originalWindow;
  } else {
    Reflect.deleteProperty(globalObject, 'window');
  }
});

describe('chat preferences', () => {
  it('keeps assistant runtime unset when local storage has no explicit choice', () => {
    globalObject.localStorage = createMemoryStorage();
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    const preferences = getStoredChatPreferences();
    assert.equal(preferences.assistant_runtime, undefined);
  });

  it('returns claude_code when explicitly stored', () => {
    const storage = createMemoryStorage();
    storage.setItem('monolith:last-assistant-runtime', 'claude_code');
    storage.setItem('monolith:last-model', 'sonnet');
    storage.setItem('monolith:last-provider-id', 'env');
    globalObject.localStorage = storage;
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    const preferences = getStoredChatPreferences();
    assert.equal(preferences.assistant_runtime, 'claude_code');
    assert.equal(preferences.model, 'sonnet');
    assert.equal(preferences.provider_id, 'env');
  });

  it('returns codex when explicitly stored', () => {
    const storage = createMemoryStorage();
    storage.setItem('monolith:last-assistant-runtime', 'codex');
    storage.setItem('monolith:last-model', 'sonnet');
    storage.setItem('monolith:last-provider-id', 'env');
    globalObject.localStorage = storage;
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    const preferences = getStoredChatPreferences();
    assert.equal(preferences.assistant_runtime, 'codex');
    // model/provider are returned as-is; callers decide whether to use them
    assert.equal(preferences.model, 'sonnet');
    assert.equal(preferences.provider_id, 'env');
  });

  it('returns pi when explicitly stored', () => {
    const storage = createMemoryStorage();
    storage.setItem('monolith:last-assistant-runtime', 'pi');
    globalObject.localStorage = storage;
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    assert.equal(getStoredChatPreferences().assistant_runtime, 'pi');
  });

  it('keeps Claude model/provider when runtime is unset', () => {
    const storage = createMemoryStorage();
    storage.setItem('monolith:last-model', 'sonnet');
    storage.setItem('monolith:last-provider-id', 'env');
    globalObject.localStorage = storage;
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    const payload = buildCreateSessionPreferencePayload();
    assert.deepEqual(payload, { model: 'sonnet', provider_id: 'env' });
  });

  it('does not treat stored runtime as an explicit runtime choice', () => {
    const storage = createMemoryStorage();
    storage.setItem('monolith:last-assistant-runtime', 'codex');
    storage.setItem('monolith:last-model', 'sonnet');
    storage.setItem('monolith:last-provider-id', 'env');
    globalObject.localStorage = storage;
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    const payload = buildCreateSessionPreferencePayload();
    assert.deepEqual(payload, { model: 'sonnet', provider_id: 'env' });
  });

  it('drops Claude model/provider for explicit Codex sessions', () => {
    const storage = createMemoryStorage();
    storage.setItem('monolith:last-assistant-runtime', 'claude_code');
    storage.setItem('monolith:last-model', 'sonnet');
    storage.setItem('monolith:last-provider-id', 'env');
    globalObject.localStorage = storage;
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    const payload = buildCreateSessionPreferencePayload('codex');
    assert.deepEqual(payload, { assistant_runtime: 'codex' });
  });

  it('drops Claude model/provider for explicit Pi sessions', () => {
    const storage = createMemoryStorage();
    storage.setItem('monolith:last-model', 'sonnet');
    storage.setItem('monolith:last-provider-id', 'env');
    globalObject.localStorage = storage;
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    assert.deepEqual(buildCreateSessionPreferencePayload('pi'), { assistant_runtime: 'pi' });
  });

  it('keeps Claude model/provider for explicit Claude sessions', () => {
    const storage = createMemoryStorage();
    storage.setItem('monolith:last-assistant-runtime', 'codex');
    storage.setItem('monolith:last-model', 'sonnet');
    storage.setItem('monolith:last-provider-id', 'env');
    globalObject.localStorage = storage;
    globalObject.window = globalObject as unknown as Window & typeof globalThis;

    const payload = buildCreateSessionPreferencePayload('claude_code');
    assert.deepEqual(payload, {
      assistant_runtime: 'claude_code',
      model: 'sonnet',
      provider_id: 'env',
    });
  });
});
