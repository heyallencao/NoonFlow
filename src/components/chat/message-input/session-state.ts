const DRAFT_BY_SESSION = new Map<string, string>();
const INPUT_HISTORY_BY_SESSION = new Map<string, string[]>();
const DEFAULT_SESSION_INPUT_KEY = '__default__';

function getSessionScopedInputKey(sessionId?: string): string {
  return sessionId || DEFAULT_SESSION_INPUT_KEY;
}

export {
  DRAFT_BY_SESSION,
  INPUT_HISTORY_BY_SESSION,
  DEFAULT_SESSION_INPUT_KEY,
  getSessionScopedInputKey,
};
