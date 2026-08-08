import { useEffect, useRef } from 'react';
import type { ChatStatus } from 'ai';
import { nanoid } from 'nanoid';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUp02Icon,
  StopIcon,
  PlusSignIcon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons';
import type { FileAttachment } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import {
  PromptInputButton,
  PromptInputSubmit,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import { subscribeAttachFileToChat } from '@/lib/events/app-event-bus';

type FileWithSourcePath = File & {
  noonflowSourcePath?: string;
  monolithSourcePath?: string;
};

/**
 * Convert a data/blob URL to a FileAttachment object.
 */
export async function dataUrlToFileAttachment(
  sourceUrl: string,
  filename: string,
  mediaType: string,
  rawFile?: File,
): Promise<FileAttachment> {
  let dataUrl = sourceUrl;

  // Prefer raw File when available to avoid blob URL conversion instability.
  if (rawFile && !dataUrl.startsWith('data:')) {
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to convert file to data URL'));
        reader.readAsDataURL(rawFile);
      });
    } catch {
      // Continue to fallback branches below.
    }
  }

  // Fallback: Some upload flows may still pass blob URLs; convert them defensively.
  if (!dataUrl.startsWith('data:') && dataUrl.startsWith('blob:')) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to convert blob URL to data URL'));
        reader.readAsDataURL(blob);
      });
    } catch {
      throw new Error('Invalid blob attachment payload');
    }
  }

  // Require canonical data URL to prevent writing corrupted tiny files.
  if (!dataUrl.startsWith('data:') || !dataUrl.includes(',')) {
    throw new Error('Invalid attachment payload');
  }

  // data:image/png;base64,<data>  — extract the base64 part
  const base64 = dataUrl.split(',')[1] || '';
  if (!base64) {
    throw new Error('Empty attachment payload');
  }

  // Estimate raw size from base64 length
  const size = Math.ceil((base64.length * 3) / 4);

  return {
    id: nanoid(),
    name: filename,
    type: mediaType || 'application/octet-stream',
    size,
    data: base64,
    sourcePath: (rawFile as FileWithSourcePath | undefined)?.noonflowSourcePath
      || (rawFile as FileWithSourcePath | undefined)?.monolithSourcePath,
  };
}

/**
 * Submit button that's aware of file attachments. Must be rendered inside PromptInput.
 */
export function FileAwareSubmitButton({
  status,
  onStop,
  disabled,
  inputValue,
  hasBadge,
}: {
  status: ChatStatus;
  onStop?: () => void;
  disabled?: boolean;
  inputValue: string;
  hasBadge: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const hasFiles = attachments.files.length > 0;
  const isStreaming = status === 'streaming' || status === 'submitted';

  // Stop button must always be enabled during streaming
  const isDisabled = isStreaming
    ? false
    : (disabled || (!inputValue.trim() && !hasBadge && !hasFiles));

  return (
    <PromptInputSubmit
      status={status}
      onStop={onStop}
      disabled={isDisabled}
      className="rounded-full"
    >
      {isStreaming ? (
        <HugeiconsIcon icon={StopIcon} className="size-4" />
      ) : (
        <HugeiconsIcon icon={ArrowUp02Icon} className="h-4 w-4" strokeWidth={2} />
      )}
    </PromptInputSubmit>
  );
}

/**
 * Attachment button that opens the file dialog. Must be rendered inside PromptInput.
 */
export function AttachFileButton() {
  const attachments = usePromptInputAttachments();
  const { t } = useTranslation();

  return (
    <PromptInputButton
      onClick={() => attachments.openFileDialog()}
      tooltip={t('messageInput.attachFiles')}
    >
      <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" />
    </PromptInputButton>
  );
}

/**
 * Infer a MIME type from a filename extension so that files added from the
 * file tree pass the PromptInput accept-type validation. Code / text files
 * are mapped to `text/*` subtypes; images and PDFs get their standard types.
 * Falls back to `application/octet-stream` for unknown extensions.
 */
function mimeFromFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const TEXT_EXTS: Record<string, string> = {
    md: 'text/markdown', mdx: 'text/markdown',
    txt: 'text/plain', csv: 'text/csv',
    json: 'application/json',
    ts: 'text/typescript', tsx: 'text/typescript',
    js: 'text/javascript', jsx: 'text/javascript',
    py: 'text/x-python', go: 'text/x-go', rs: 'text/x-rust',
    rb: 'text/x-ruby', java: 'text/x-java', c: 'text/x-c',
    cpp: 'text/x-c++', h: 'text/x-c', hpp: 'text/x-c++',
    cs: 'text/x-csharp', swift: 'text/x-swift', kt: 'text/x-kotlin',
    html: 'text/html', css: 'text/css', scss: 'text/css',
    xml: 'text/xml', yaml: 'text/yaml', yml: 'text/yaml',
    toml: 'text/plain', ini: 'text/plain', cfg: 'text/plain',
    sh: 'text/x-shellscript', bash: 'text/x-shellscript', zsh: 'text/x-shellscript',
    sql: 'text/x-sql', graphql: 'text/plain', gql: 'text/plain',
    vue: 'text/plain', svelte: 'text/plain', astro: 'text/plain',
    env: 'text/plain', gitignore: 'text/plain', dockerignore: 'text/plain',
    dockerfile: 'text/plain', makefile: 'text/plain',
    log: 'text/plain', lock: 'text/plain',
  };
  const IMAGE_EXTS: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  };
  if (TEXT_EXTS[ext]) return TEXT_EXTS[ext];
  if (IMAGE_EXTS[ext]) return IMAGE_EXTS[ext];
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

/**
 * Bridge component that listens for file tree attachment events
 * from the file tree and adds files as attachments. Must be rendered inside PromptInput.
 */
export function FileTreeAttachmentBridge() {
  const attachments = usePromptInputAttachments();
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const unsubscribe = subscribeAttachFileToChat(async ({ path: filePath }) => {
      if (!filePath) return;

      try {
        const res = await fetch(`/api/files/raw?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) {
          console.warn(`[FileTreeAttachment] Failed to fetch file: ${res.status} ${res.statusText}`, filePath);
          return;
        }
        const blob = await res.blob();
        // Handle both Unix (/) and Windows (\) path separators
        const filename = filePath.split(/[/\\]/).pop() || 'file';
        // Use a proper MIME type derived from the extension so the file
        // passes PromptInput's accept-type validation (text/* etc.)
        const mime = mimeFromFilename(filename);
        const file = new File([blob], filename, { type: mime });
        (file as FileWithSourcePath).noonflowSourcePath = filePath;
        attachmentsRef.current.add([file]);
      } catch (err) {
        console.warn('[FileTreeAttachment] Error attaching file:', filePath, err);
      }
    });

    return unsubscribe;
  }, []);

  return null;
}

/**
 * Capsule display for attached files, rendered inside PromptInput context.
 */
export function FileAttachmentsCapsules() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
      {attachments.files.map((file) => {
        const isImage = file.mediaType?.startsWith('image/');
        return (
          <span
            key={file.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 pl-2 pr-1 py-0.5 text-xs font-medium border border-emerald-500/20"
          >
            {isImage && file.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt={file.filename || 'image'}
                className="h-5 w-5 rounded object-cover"
              />
            )}
            <span className="max-w-[120px] truncate text-[11px]">
              {file.filename || 'file'}
            </span>
            <button
              type="button"
              onClick={() => attachments.remove(file.id)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-500/20 transition-colors"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="h-3 w-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
