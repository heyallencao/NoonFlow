import fs from 'fs';
import os from 'os';
import path from 'path';

import type {
  SDKAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type {
  FileAttachment,
  SSEEvent,
  TokenUsage,
} from '@/types';
import { isImageFile } from '@/types';
import { getProjectUploadDir } from '@/lib/upload-paths';

/**
 * Format an SSE line from an event object.
 */
export function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Extract text content from an SDK assistant message.
 */
export function extractTextFromMessage(msg: SDKAssistantMessage): string {
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * Extract token usage from an SDK result message.
 */
export function extractTokenUsage(msg: SDKResultMessage): TokenUsage | null {
  if (!msg.usage) {
    return null;
  }

  return {
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cost_usd: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
  };
}

/**
 * Get the upload directory path for a given working directory.
 * Returns ~/.noonflow/upload_files/{project-identifier}/ instead of
 * {workDir}/.noonflow-uploads.
 * Uses basename + MD5 hash to avoid collisions between projects with same name.
 */
function getUploadDir(workDir: string): string {
  return getProjectUploadDir(workDir);
}

/**
 * Get file paths for non-image attachments. If the file already has a
 * persisted filePath (written by the uploads route), reuse it. Otherwise
 * fall back to writing the file to ~/.noonflow/upload_files/{project-identifier}/.
 */
export function getUploadedFilePaths(files: FileAttachment[], workDir: string): string[] {
  const paths: string[] = [];
  let uploadDir: string | undefined;

  for (const file of files) {
    if (file.filePath) {
      paths.push(file.filePath);
      continue;
    }

    if (!uploadDir) {
      uploadDir = getUploadDir(workDir);
    }

    const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
    const buffer = Buffer.from(file.data, 'base64');
    fs.writeFileSync(filePath, buffer);
    paths.push(filePath);
  }

  return paths;
}

/**
 * Build a context-enriched prompt by prepending conversation history.
 * Used when SDK session resume is unavailable or fails.
 */
export function buildPromptWithHistory(
  prompt: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  if (!history || history.length === 0) {
    return prompt;
  }

  const lines: string[] = ['<conversation_history>'];

  for (const msg of history) {
    let content = msg.content;

    if (msg.role === 'assistant' && content.startsWith('[')) {
      try {
        const blocks = JSON.parse(content);
        const parts: string[] = [];
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            parts.push(block.text);
          } else if (block.type === 'tool_use') {
            parts.push(`[Used tool: ${block.name}]`);
          } else if (block.type === 'tool_result') {
            const resultStr = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
            parts.push(`[Tool result: ${resultStr.slice(0, 500)}${resultStr.length > 500 ? '...' : ''}]`);
          }
        }
        content = parts.join('\n');
      } catch {
        // Not JSON, keep original content.
      }
    }

    lines.push(`${msg.role === 'user' ? 'Human' : 'Assistant'}: ${content}`);
  }

  lines.push('</conversation_history>');
  lines.push('');
  lines.push(prompt);
  return lines.join('\n');
}

interface BuildFinalPromptOptions {
  prompt: string;
  useHistory: boolean;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  files?: FileAttachment[];
  workingDirectory?: string;
  imageAgentMode?: boolean;
  sdkSessionId?: string;
}

/**
 * Build the final prompt payload for SDK query().
 * Can return plain text or an AsyncIterable containing vision blocks.
 */
export function buildFinalPrompt({
  prompt,
  useHistory,
  conversationHistory,
  files,
  workingDirectory,
  imageAgentMode,
  sdkSessionId,
}: BuildFinalPromptOptions): string | AsyncIterable<SDKUserMessage> {
  const basePrompt = useHistory
    ? buildPromptWithHistory(prompt, conversationHistory)
    : prompt;

  if (!files || files.length === 0) {
    return basePrompt;
  }

  const imageFiles = files.filter((file) => isImageFile(file.type));
  const nonImageFiles = files.filter((file) => !isImageFile(file.type));

  let textPrompt = basePrompt;
  if (nonImageFiles.length > 0) {
    const workDir = workingDirectory || os.homedir();
    const savedPaths = getUploadedFilePaths(nonImageFiles, workDir);
    const fileReferences = savedPaths
      .map((savedPath, index) => `[User attached file: ${savedPath} (${nonImageFiles[index].name})]`)
      .join('\n');
    textPrompt = `${fileReferences}\n\nPlease read the attached file(s) above using your Read tool, then respond to the user's message:\n\n${basePrompt}`;
  }

  if (imageFiles.length === 0) {
    return textPrompt;
  }

  const textWithImageRefs = imageAgentMode
    ? textPrompt
    : (() => {
        const workDir = workingDirectory || os.homedir();
        const imagePaths = getUploadedFilePaths(imageFiles, workDir);
        const imageReferences = imagePaths
          .map((savedPath, index) => `[User attached image: ${savedPath} (${imageFiles[index].name})]`)
          .join('\n');
        return `${imageReferences}\n\n${textPrompt}`;
      })();

  const contentBlocks: Array<
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'text'; text: string }
  > = [];

  for (const imageFile of imageFiles) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageFile.type || 'image/png',
        data: imageFile.data,
      },
    });
  }

  contentBlocks.push({ type: 'text', text: textWithImageRefs });

  const userMessage: SDKUserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: contentBlocks,
    },
    parent_tool_use_id: null,
    session_id: sdkSessionId || '',
  };

  return (async function* () {
    yield userMessage;
  })();
}
