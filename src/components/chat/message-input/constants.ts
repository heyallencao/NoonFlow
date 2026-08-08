import {
  HelpCircleIcon,
  CommandLineIcon,
  Delete02Icon,
  Coins01Icon,
  FileZipIcon,
  Stethoscope02Icon,
  FileEditIcon,
  SearchList01Icon,
  BrainIcon,
} from '@hugeicons/core-free-icons';
import type { TranslationKey } from '@/i18n';

export interface PopoverItem {
  label: string;
  value: string;
  description?: string;
  descriptionKey?: TranslationKey;
  builtIn?: boolean;
  immediate?: boolean;
  installedSource?: 'agents' | 'claude';
  source?: 'global' | 'project' | 'plugin' | 'installed';
  icon?: typeof CommandLineIcon;
}

export interface CommandBadge {
  command: string;
  label: string;
  description: string;
  isSkill: boolean;
  installedSource?: 'agents' | 'claude';
}

export type PopoverMode = 'file' | 'skill' | null;

export const IMAGE_AGENT_SYSTEM_PROMPT = `你是一个图像生成助手。当用户请求生成图片时，分析用户意图并以结构化格式输出。

## 单张生成
如果用户只需要生成一张图片，输出：
\`\`\`image-gen-request
{"prompt":"详细的英文描述","aspectRatio":"1:1","resolution":"1K"}
\`\`\`

## 批量生成
如果用户提供了文档/列表/多个需求，需要批量生成多张图片，输出：
\`\`\`batch-plan
{"summary":"计划摘要","items":[{"prompt":"英文描述","aspectRatio":"1:1","resolution":"1K","tags":[]}]}
\`\`\`

## 参考图（垫图）
如果用户上传了图片，这些图片会自动作为参考图传给图片生成模型。你在 prompt 中应该描述如何利用这些参考图，例如：
- 基于参考图的风格/内容进行创作
- 将参考图中的元素融入新图
- 按照参考图的构图生成新图

## 连续编辑（基于上一次生成结果）
如果用户要求修改/编辑/调整之前生成的图片，在 JSON 中加入 "useLastGenerated": true，系统会自动将上次生成的结果图作为参考图传入。
编辑模式下 prompt 要简洁直接，只描述要做的修改，不要重复描述整张图片的内容。例如：
- 用户说"去掉右边的香水" → prompt: "Remove the perfume bottle on the right side of the image"
- 用户说"把背景换成蓝色" → prompt: "Change the background color to blue"
- 用户说"加个太阳" → prompt: "Add a sun in the sky"

\`\`\`image-gen-request
{"prompt":"简洁的英文编辑指令","aspectRatio":"1:1","resolution":"1K","useLastGenerated":true}
\`\`\`

## 规则
- 新图生成时 prompt 必须是详细的英文描述
- 编辑已有图片时 prompt 应该简洁直接，只描述修改内容
- aspectRatio 可选: 1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4
- resolution 可选: 1K, 2K, 4K
- 批量生成时每个 item 都需要独立的详细 prompt
- 如果用户没有特别要求比例和分辨率，使用 1:1 和 1K 作为默认值
- 如果用户上传了参考图，prompt 中要明确说明如何使用这些参考图
- 如果用户要求修改上一张生成的图片，必须加 "useLastGenerated": true
- 在输出结构化块之前，可以先简要说明你的理解和计划`;

// Expansion prompts for CLI-only commands (not natively supported by SDK).
// SDK-native commands (/compact, /init, /review) are sent as-is — the SDK handles them directly.
export const COMMAND_PROMPTS: Record<string, string> = {
  '/doctor': 'Run diagnostic checks on this project. Check system health, dependencies, configuration files, and report any issues.',
  '/terminal-setup': 'Help me configure my terminal for optimal use with Claude Code. Check current setup and suggest improvements.',
  '/memory': 'Show the current CLAUDE.md project memory file and help me review or edit it.',
};

export const BUILT_IN_COMMANDS: PopoverItem[] = [
  { label: 'help', value: '/help', description: 'Show available commands and tips', descriptionKey: 'messageInput.helpDesc', builtIn: true, immediate: true, icon: HelpCircleIcon },
  { label: 'clear', value: '/clear', description: 'Clear conversation history', descriptionKey: 'messageInput.clearDesc', builtIn: true, immediate: true, icon: Delete02Icon },
  { label: 'cost', value: '/cost', description: 'Show token usage statistics', descriptionKey: 'messageInput.costDesc', builtIn: true, immediate: true, icon: Coins01Icon },
  { label: 'compact', value: '/compact', description: 'Compress conversation context', descriptionKey: 'messageInput.compactDesc', builtIn: true, icon: FileZipIcon },
  { label: 'doctor', value: '/doctor', description: 'Diagnose project health', descriptionKey: 'messageInput.doctorDesc', builtIn: true, icon: Stethoscope02Icon },
  { label: 'init', value: '/init', description: 'Initialize CLAUDE.md for project', descriptionKey: 'messageInput.initDesc', builtIn: true, icon: FileEditIcon },
  { label: 'review', value: '/review', description: 'Review code quality', descriptionKey: 'messageInput.reviewDesc', builtIn: true, icon: SearchList01Icon },
  { label: 'terminal-setup', value: '/terminal-setup', description: 'Configure terminal settings', descriptionKey: 'messageInput.terminalSetupDesc', builtIn: true, icon: CommandLineIcon },
  { label: 'memory', value: '/memory', description: 'Edit project memory file', descriptionKey: 'messageInput.memoryDesc', builtIn: true, icon: BrainIcon },
];

export const MODE_OPTIONS = [
  { value: 'code', label: 'Code' },
  { value: 'plan', label: 'Plan' },
];

// Default Claude model options — used as fallback when API is unavailable
export const DEFAULT_MODEL_OPTIONS = [
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
];
