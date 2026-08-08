import { useCallback, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { ImageGenContextValue } from '@/hooks/useImageGen';
import { deleteRefImages, PENDING_KEY, setRefImages } from '@/lib/image-ref-store';
import type { FileAttachment } from '@/types';
import {
  BUILT_IN_COMMANDS,
  COMMAND_PROMPTS,
  IMAGE_AGENT_SYSTEM_PROMPT,
  type CommandBadge,
} from '../constants';
import { dataUrlToFileAttachment } from '../helpers';

interface PromptInputFilePart {
  type: string;
  url: string;
  filename?: string;
  mediaType?: string;
  rawFile?: File;
}

interface PromptInputSubmitMessage {
  text: string;
  files: PromptInputFilePart[];
}

interface UseSubmitHandlerOptions {
  onSend: (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string) => void;
  onCommand?: (command: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  badge: CommandBadge | null;
  setBadge: (badge: CommandBadge | null) => void;
  imageGen: ImageGenContextValue;
  workingDirectory?: string;
  closePopover: () => void;
  setInputValue: (value: string) => void;
  commitInputToHistory: (value: string) => void;
}

async function convertPromptInputFiles(files: PromptInputFilePart[] | undefined): Promise<FileAttachment[]> {
  if (!files || files.length === 0) return [];

  const attachments: FileAttachment[] = [];
  for (const file of files) {
    if (!file.url) continue;
    try {
      const attachment = await dataUrlToFileAttachment(
        file.url,
        file.filename || 'file',
        file.mediaType || 'application/octet-stream',
        file.rawFile,
      );
      attachments.push(attachment);
    } catch {
      // Skip files that fail conversion.
    }
  }

  return attachments;
}

export function useSubmitHandler({
  onSend,
  onCommand,
  disabled,
  isStreaming,
  badge,
  setBadge,
  imageGen,
  workingDirectory,
  closePopover,
  setInputValue,
  commitInputToHistory,
}: UseSubmitHandlerOptions) {
  return useCallback(async (msg: PromptInputSubmitMessage, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = msg.text.trim();

    closePopover();

    if (imageGen.state.enabled && !badge && !isStreaming) {
      const files = await convertPromptInputFiles(msg.files);
      if (!content && files.length === 0) return;

      const imageFiles = files.filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        setRefImages(PENDING_KEY, imageFiles.map((file) => ({ mimeType: file.type, data: file.data })));
      } else {
        deleteRefImages(PENDING_KEY);
      }

      commitInputToHistory(content);
      setInputValue('');
      onSend(content, files.length > 0 ? files : undefined, IMAGE_AGENT_SYSTEM_PROMPT);
      return;
    }

    if (badge && !isStreaming) {
      let expandedPrompt = '';
      let skillLoadError: string | null = null;

      if (badge.isSkill) {
        try {
          const detailParams = new URLSearchParams();
          if (badge.installedSource) detailParams.set('source', badge.installedSource);
          if (workingDirectory) detailParams.set('cwd', workingDirectory);
          const queryString = detailParams.toString();
          const response = await fetch(
            `/api/skills/${encodeURIComponent(badge.label)}${queryString ? `?${queryString}` : ''}`
          );

          if (!response.ok) {
            let detail = '';
            try {
              const errorData = await response.json() as { error?: string };
              detail = errorData.error || '';
            } catch {
              // Keep default message when body is not JSON.
            }
            skillLoadError = detail
              ? `Failed to load skill "${badge.label}": ${detail}`
              : `Failed to load skill "${badge.label}" (${response.status})`;
          } else {
            const data = await response.json() as { skill?: { content?: string } };
            expandedPrompt = data.skill?.content?.trim() || '';
            if (!expandedPrompt) {
              skillLoadError = `Skill "${badge.label}" content is empty`;
            }
          }
        } catch {
          skillLoadError = `Failed to load skill "${badge.label}" due to a network or runtime error`;
        }
      } else {
        expandedPrompt = COMMAND_PROMPTS[badge.command] || '';
      }

      if (badge.isSkill && skillLoadError) {
        toast.error(skillLoadError);
        return;
      }

      const files = await convertPromptInputFiles(msg.files);
      commitInputToHistory(content);
      setBadge(null);
      setInputValue('');

      if (badge.isSkill) {
        const skillMeta: { name: string; description?: string } = { name: badge.label };
        const normalizedSkillDescription = badge.description.trim();
        if (normalizedSkillDescription) {
          skillMeta.description = normalizedSkillDescription;
        }

        const skillDisplay = `<!--skill:${JSON.stringify(skillMeta)}-->\n${content}`.trim();
        const finalContent = content
          ? `Use the ${badge.label} skill.\n\nUser context: ${content}`
          : `Use the ${badge.label} skill.`;

        onSend(
          finalContent,
          files.length > 0 ? files : undefined,
          expandedPrompt || undefined,
          skillDisplay,
        );
        return;
      }

      const finalPrompt = content
        ? `${expandedPrompt}\n\nUser context: ${content}`
        : expandedPrompt || badge.command;
      onSend(finalPrompt, files.length > 0 ? files : undefined);
      return;
    }

    const files = await convertPromptInputFiles(msg.files);
    const hasFiles = files.length > 0;

    if ((!content && !hasFiles) || disabled || isStreaming) return;

    const isSingleSegmentSlashToken = /^\/[^/\s]+$/.test(content);
    if (isSingleSegmentSlashToken && !hasFiles) {
      const command = BUILT_IN_COMMANDS.find((item) => item.value === content);
      if (command) {
        if (command.immediate && onCommand) {
          commitInputToHistory(content);
          setInputValue('');
          onCommand(content);
          return;
        }

        setBadge({
          command: command.value,
          label: command.label,
          description: command.description || '',
          isSkill: false,
        });
        setInputValue('');
        return;
      }

      const skillName = content.slice(1);
      if (skillName) {
        setBadge({
          command: content,
          label: skillName,
          description: '',
          isSkill: true,
        });
        setInputValue('');
        return;
      }
    }

    commitInputToHistory(content);
    onSend(content || 'Please review the attached file(s).', hasFiles ? files : undefined);
    setInputValue('');
  }, [
    badge,
    closePopover,
    commitInputToHistory,
    disabled,
    imageGen,
    isStreaming,
    onCommand,
    onSend,
    setBadge,
    setInputValue,
    workingDirectory,
  ]);
}
