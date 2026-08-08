import type { Ref } from 'react';
import type { AssistantRuntime, FileAttachment } from '@/types';

export interface MessageInputProps {
  onSend: (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string) => void;
  onCommand?: (command: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  sessionId?: string;
  modelName?: string;
  onModelChange?: (model: string) => void;
  providerId?: string;
  onProviderModelChange?: (providerId: string, model: string) => void;
  assistantRuntime?: AssistantRuntime;
  workingDirectory?: string;
  mode?: string;
  onModeChange?: (mode: string) => void;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  showQuickSkills?: boolean;
  containerRef?: Ref<HTMLDivElement>;
}
