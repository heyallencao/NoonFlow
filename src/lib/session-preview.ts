export type SessionPreviewTag = 'paths' | 'code' | 'images' | 'attachments';

interface SessionPreviewSummary {
  preview: string;
  tags: SessionPreviewTag[];
}

const MAX_PREVIEW_LENGTH = 160;

function truncate(text: string, maxLength: number = MAX_PREVIEW_LENGTH): string {
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}...` : text;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function detectTags(text: string): Set<SessionPreviewTag> {
  const tags = new Set<SessionPreviewTag>();

  if (/<attached_files>/i.test(text)) {
    tags.add('attachments');
  }

  if (/\[Image\s*#\d+\]/i.test(text) || /<image\b/i.test(text)) {
    tags.add('images');
  }

  if (/```/.test(text)) {
    tags.add('code');
  }

  if (
    /(^|\n)\s*(import |export |const |let |var |function |class |if\s*\(|return\b|SELECT\b|INSERT\b|UPDATE\b|DELETE\b|diff --git|@@ )/m.test(text)
    || /[{};]{2,}/.test(text)
  ) {
    tags.add('code');
  }

  if (
    /(^|\n)\s*(\/|~\/|\.\/|\.\.\/|src\/|app\/|docs\/|packages\/|website\/).+/m.test(text)
    || /[A-Za-z0-9._/-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?/m.test(text)
  ) {
    tags.add('paths');
  }

  return tags;
}

function stripTaggedBlocks(text: string): string {
  return text
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, ' ')
    .replace(/<attached_files>[\s\S]*?<\/attached_files>/gi, ' ')
    .replace(/<conversation_history>[\s\S]*?<\/conversation_history>/gi, ' ')
    .replace(/<system_prompt>[\s\S]*?<\/system_prompt>/gi, ' ')
    .replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, ' ');
}

function isPathLikeLine(line: string): boolean {
  return /^([/~.]|src\/|app\/|docs\/|packages\/|website\/)/.test(line)
    || /^[A-Za-z0-9._/-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?$/.test(line);
}

function isStructuralLine(line: string): boolean {
  return line.startsWith('# AGENTS.md instructions for ')
    || /^<\/?[A-Za-z_][^>]*>$/.test(line)
    || /^\[Image\s*#\d+\]$/i.test(line)
    || /^User:\s*$/i.test(line)
    || /^Assistant:\s*$/i.test(line)
    || /^[-=*]{3,}$/.test(line);
}

function isCodeLikeLine(line: string): boolean {
  return /^(```|~~~)/.test(line)
    || /^(import |export |const |let |var |function |class |if\s*\(|return\b|SELECT\b|INSERT\b|UPDATE\b|DELETE\b|diff --git|@@ )/.test(line)
    || /[{};]{2,}/.test(line);
}

function stripInlineNoise(line: string): string {
  return normalizeWhitespace(
    line
      .replace(/^\[\d+\]\s*[×⨯xX]?\s*/u, '')
      .replace(/^User:\s*/i, '')
      .replace(/^Assistant:\s*/i, '')
      .replace(/\[Image\s*#\d+\]/gi, '')
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
  );
}

function pickReadableLine(text: string): string {
  const lines = stripTaggedBlocks(text)
    .split('\n')
    .map((line) => stripInlineNoise(line))
    .filter(Boolean);

  for (const line of lines) {
    if (isStructuralLine(line) || isPathLikeLine(line) || isCodeLikeLine(line)) {
      continue;
    }
    if (/^[\d\s.:/-]+$/.test(line)) {
      continue;
    }
    return truncate(line);
  }

  for (const line of lines) {
    if (isStructuralLine(line) || isCodeLikeLine(line)) {
      continue;
    }
    if (isPathLikeLine(line)) {
      continue;
    }
    return truncate(line);
  }

  return '';
}

export function summarizeSessionPreview(...sources: Array<string | null | undefined>): SessionPreviewSummary {
  const combinedTags = new Set<SessionPreviewTag>();
  let preview = '';

  for (const source of sources) {
    const text = typeof source === 'string' ? source.trim() : '';
    if (!text) {
      continue;
    }

    for (const tag of detectTags(text)) {
      combinedTags.add(tag);
    }

    if (!preview) {
      preview = pickReadableLine(text);
    }
  }

  return {
    preview,
    tags: Array.from(combinedTags),
  };
}
