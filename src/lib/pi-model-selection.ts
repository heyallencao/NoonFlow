export const PI_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type PiThinkingLevel = typeof PI_THINKING_LEVELS[number];

const PI_THINKING_LEVEL_SET = new Set<string>(PI_THINKING_LEVELS);

export function splitPiModelSelection(value?: string): {
  model: string;
  thinkingLevel?: PiThinkingLevel;
} {
  const normalized = value?.trim() || '';
  const separatorIndex = normalized.lastIndexOf(':');
  if (separatorIndex <= 0) {
    return { model: normalized };
  }

  const suffix = normalized.slice(separatorIndex + 1).toLowerCase();
  if (!PI_THINKING_LEVEL_SET.has(suffix)) {
    return { model: normalized };
  }

  return {
    model: normalized.slice(0, separatorIndex),
    thinkingLevel: suffix as PiThinkingLevel,
  };
}

export function composePiModelSelection(
  model: string,
  thinkingLevel?: PiThinkingLevel,
): string {
  const baseModel = splitPiModelSelection(model).model;
  if (!baseModel || !thinkingLevel) {
    return baseModel;
  }
  return `${baseModel}:${thinkingLevel}`;
}
