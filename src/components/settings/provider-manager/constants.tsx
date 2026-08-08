import type { ReactNode } from 'react';

import { HugeiconsIcon } from '@hugeicons/react';
import { ServerStack01Icon, Settings02Icon } from '@hugeicons/core-free-icons';

import type { ApiProvider } from '@/types';

/** Map a provider name / base_url to a brand icon */
export function getProviderIcon(name: string, baseUrl: string): ReactNode {
  const lower = name.toLowerCase();
  const url = baseUrl.toLowerCase();

  if (lower.includes('openrouter')) return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('bigmodel.cn') || url.includes('z.ai') || lower.includes('glm') || lower.includes('zhipu') || lower.includes('chatglm'))
    return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('kimi.com') || lower.includes('kimi')) return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('moonshot') || lower.includes('moonshot')) return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('minimax') || lower.includes('minimax')) return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('volces.com') || url.includes('volcengine') || lower.includes('volcengine') || lower.includes('火山') || lower.includes('doubao') || lower.includes('豆包'))
    return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('dashscope') || lower.includes('bailian') || lower.includes('百炼') || lower.includes('aliyun'))
    return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('deepseek.com') || lower.includes('deepseek'))
    return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('siliconflow') || lower.includes('siliconflow'))
    return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('stepfun') || lower.includes('stepfun') || lower.includes('step'))
    return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (url.includes('qianfan') || lower.includes('qianfan') || lower.includes('千帆') || lower.includes('baidu'))
    return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (lower.includes('bedrock')) return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (lower.includes('vertex') || lower.includes('google')) return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (lower.includes('aws')) return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
  if (lower.includes('anthropic') || url.includes('anthropic')) return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;

  return <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />;
}

export function reorderProviders(items: ApiProvider[], draggedId: string, targetId: string): ApiProvider[] {
  if (!draggedId || !targetId || draggedId === targetId) {
    return items;
  }

  const fromIndex = items.findIndex((item) => item.id === draggedId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0) {
    return items;
  }

  const next = [...items];
  const [dragged] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, dragged);

  return next.map((item, index) => ({
    ...item,
    sort_order: index,
  }));
}

export interface QuickPreset {
  key: string;
  name: string;
  description: string;
  descriptionZh: string;
  icon: ReactNode;
  provider_type: string;
  base_url: string;
  extra_env: string;
  fields: ('name' | 'api_key' | 'base_url' | 'extra_env' | 'model_names')[];
  category?: 'chat' | 'media';
  /** Recommended models for this provider */
  suggested_models?: Array<{ value: string; label: string }>;
}

export const QUICK_PRESETS: QuickPreset[] = [
  {
    key: 'custom-api',
    name: 'Custom API',
    description: 'Custom API endpoint — fill in all fields',
    descriptionZh: '自定义 API 端点 — 填写所有信息',
    icon: <HugeiconsIcon icon={Settings02Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: '',
    extra_env: '{}',
    fields: ['name', 'api_key', 'base_url', 'extra_env'],
  },
  {
    key: 'anthropic-thirdparty',
    name: 'Anthropic Third-party API',
    description: 'Anthropic-compatible API — provide URL and Key',
    descriptionZh: 'Anthropic 兼容第三方 API — 填写地址和密钥',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'anthropic',
    base_url: '',
    extra_env: '{"ANTHROPIC_API_KEY":""}',
    fields: ['name', 'api_key', 'base_url', 'model_names'],
  },
  {
    key: 'anthropic-official',
    name: 'Anthropic',
    description: 'Official Anthropic API',
    descriptionZh: 'Anthropic 官方 API',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'anthropic',
    base_url: 'https://api.anthropic.com',
    extra_env: '{}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'claude-opus-4-6', label: 'Claude 4.6 Opus (1M)' },
      { value: 'claude-sonnet-4-6', label: 'Claude 4.6 Sonnet (200K)' },
      { value: 'claude-opus-4-5', label: 'Claude 4.5 Opus (200K)' },
      { value: 'claude-sonnet-4-5', label: 'Claude 4.5 Sonnet (200K)' },
    ],
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    description: 'Use OpenRouter to access multiple models',
    descriptionZh: '通过 OpenRouter 访问多种模型',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'openrouter',
    base_url: 'https://openrouter.ai/api',
    extra_env: '{"ANTHROPIC_API_KEY":""}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'anthropic/claude-opus-4-6', label: 'Claude 4.6 Opus (1M)' },
      { value: 'anthropic/claude-sonnet-4-6', label: 'Claude 4.6 Sonnet (200K)' },
      { value: 'openai/gpt-5.5', label: 'GPT-5.5 (1.05M)' },
      { value: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex (400K)' },
      { value: 'google/gemini-3.1-pro', label: 'Gemini 3.1 Pro (2M+)' },
      { value: 'deepseek/deepseek-r1', label: 'DeepSeek R1 (164K)' },
      { value: 'alibaba/qwen-3.5-max', label: 'Qwen 3.5-Max (1M)' },
    ],
  },
  {
    key: 'glm-cn',
    name: 'GLM (CN)',
    description: 'Zhipu GLM Code Plan — China region',
    descriptionZh: '智谱 GLM 编程套餐 — 中国区',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://open.bigmodel.cn/api/anthropic',
    extra_env: '{"API_TIMEOUT_MS":"3000000","ANTHROPIC_API_KEY":""}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'glm-5', label: 'GLM-5 (200K)' },
      { value: 'glm-5-reasoning', label: 'GLM-5 Reasoning (200K)' },
      { value: 'glm-4-long', label: 'GLM-4 Long (2M)' },
      { value: 'glm-4.5', label: 'GLM-4.5 (200K)' },
    ],
  },
  {
    key: 'glm-global',
    name: 'GLM (Global)',
    description: 'Zhipu GLM Code Plan — Global region',
    descriptionZh: '智谱 GLM 编程套餐 — 国际区',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://api.z.ai/api/anthropic',
    extra_env: '{"API_TIMEOUT_MS":"3000000","ANTHROPIC_API_KEY":""}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'glm-5', label: 'GLM-5 (200K)' },
      { value: 'glm-5-reasoning', label: 'GLM-5 Reasoning (200K)' },
      { value: 'glm-4-long', label: 'GLM-4 Long (2M)' },
      { value: 'glm-4.5', label: 'GLM-4.5 (200K)' },
    ],
  },
  {
    key: 'kimi',
    name: 'Kimi Coding Plan',
    description: 'Kimi Coding Plan API',
    descriptionZh: 'Kimi 编程计划 API',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://api.kimi.com/coding/',
    extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'kimi-k2.5', label: 'Kimi K2.5 (2M)' },
      { value: 'kimi-k2', label: 'Kimi K2 (2M)' },
      { value: 'kimi-k1.6', label: 'Kimi K1.6 (256K)' },
    ],
  },
  {
    key: 'moonshot',
    name: 'Moonshot',
    description: 'Moonshot AI API',
    descriptionZh: '月之暗面 API',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://api.moonshot.cn/anthropic',
    extra_env: '{"ANTHROPIC_API_KEY":""}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'kimi-k2.5', label: 'Kimi K2.5 (2M)' },
      { value: 'kimi-k2', label: 'Kimi K2 (2M)' },
      { value: 'kimi-k1.6', label: 'Kimi K1.6 (256K)' },
    ],
  },
  {
    key: 'minimax-cn',
    name: 'MiniMax (CN)',
    description: 'MiniMax Code Plan — China region',
    descriptionZh: 'MiniMax 编程套餐 — 中国区',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://api.minimaxi.com/anthropic',
    extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_API_KEY":""}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'minimax-m1', label: 'MiniMax M1 (1M)' },
      { value: 'minimax-m2.7', label: 'MiniMax M2.7 (200K)' },
      { value: 'minimax-text-01', label: 'MiniMax Text-01 (1M)' },
    ],
  },
  {
    key: 'minimax-global',
    name: 'MiniMax (Global)',
    description: 'MiniMax Code Plan — Global region',
    descriptionZh: 'MiniMax 编程套餐 — 国际区',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://api.minimax.io/anthropic',
    extra_env: '{"API_TIMEOUT_MS":"3000000","CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","ANTHROPIC_API_KEY":""}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'minimax-m1', label: 'MiniMax M1 (1M)' },
      { value: 'minimax-m2.7', label: 'MiniMax M2.7 (200K)' },
      { value: 'minimax-text-01', label: 'MiniMax Text-01 (1M)' },
    ],
  },
  {
    key: 'volcengine',
    name: 'Volcengine Ark',
    description: 'Volcengine Ark Coding Plan — Doubao, GLM, DeepSeek, Kimi',
    descriptionZh: '字节火山方舟 Coding Plan — 豆包、GLM、DeepSeek、Kimi',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://ark.cn-beijing.volces.com/api/coding',
    extra_env: '{"ANTHROPIC_AUTH_TOKEN":""}',
    fields: ['api_key', 'model_names'],
    suggested_models: [
      { value: 'doubao-pro', label: 'Doubao Pro' },
      { value: 'doubao-lite', label: 'Doubao Lite' },
      { value: 'deepseek-r1', label: 'DeepSeek R1 (164K)' },
      { value: 'deepseek-v3', label: 'DeepSeek V3 (128K)' },
      { value: 'glm-5', label: 'GLM-5 (200K)' },
      { value: 'kimi-k2.5', label: 'Kimi K2.5 (2M)' },
    ],
  },
  {
    key: 'bailian',
    name: 'Aliyun Bailian',
    description: 'Aliyun Bailian Coding Plan — Qwen, GLM, Kimi, MiniMax',
    descriptionZh: '阿里云百炼 Coding Plan — 通义千问、GLM、Kimi、MiniMax',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    extra_env: '{"ANTHROPIC_API_KEY":""}',
    fields: ['api_key'],
    suggested_models: [
      { value: 'qwen-3.5-max', label: 'Qwen 3.5-Max (1M)' },
      { value: 'qwen-3.5-plus', label: 'Qwen 3.5-Plus (1M)' },
      { value: 'qwen-3.5-coder', label: 'Qwen 3.5-Coder (1M)' },
      { value: 'qwen2.5', label: 'Qwen 2.5 (1M)' },
      { value: 'deepseek-r1', label: 'DeepSeek R1 (164K)' },
      { value: 'glm-5', label: 'GLM-5 (200K)' },
      { value: 'kimi-k2.5', label: 'Kimi K2.5 (2M)' },
    ],
  },
  {
    key: 'bedrock',
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock — requires AWS credentials',
    descriptionZh: 'Amazon Bedrock — 需要 AWS 凭证',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'bedrock',
    base_url: '',
    extra_env: '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1","CLAUDE_CODE_SKIP_BEDROCK_AUTH":"1"}',
    fields: ['extra_env'],
    suggested_models: [
      { value: 'us.anthropic.claude-opus-4-6', label: 'Claude 4.6 Opus (1M)' },
      { value: 'us.anthropic.claude-sonnet-4-6', label: 'Claude 4.6 Sonnet (200K)' },
      { value: 'us.anthropic.claude-opus-4-5', label: 'Claude 4.5 Opus (200K)' },
      { value: 'us.anthropic.claude-sonnet-4-5', label: 'Claude 4.5 Sonnet (200K)' },
    ],
  },
  {
    key: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek official API',
    descriptionZh: 'DeepSeek 官方 API',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://api.deepseek.com/v1',
    extra_env: '{}',
    fields: ['api_key', 'model_names'],
    suggested_models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
  },
  {
    key: 'siliconflow',
    name: 'SiliconFlow',
    description: 'SiliconFlow official API',
    descriptionZh: 'SiliconFlow 官方 API',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://api.siliconflow.cn/v1',
    extra_env: '{}',
    fields: ['api_key', 'model_names'],
    suggested_models: [
      { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
      { value: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
      { value: 'Qwen/Qwen2.5-Coder-32B-Instruct', label: 'Qwen 2.5 Coder 32B' },
    ],
  },
  {
    key: 'stepfun',
    name: 'StepFun',
    description: 'StepFun official API',
    descriptionZh: '阶跃星辰官方 API',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://api.stepfun.com/v1',
    extra_env: '{}',
    fields: ['api_key', 'model_names'],
    suggested_models: [
      { value: 'step-2-16k', label: 'Step 2 16K' },
      { value: 'step-1v-8k', label: 'Step 1V 8K' },
    ],
  },
  {
    key: 'qianfan',
    name: 'Baidu Qianfan',
    description: 'Baidu Qianfan official API',
    descriptionZh: '百度千帆官方 API',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'https://qianfan.baidubce.com/v2',
    extra_env: '{}',
    fields: ['api_key', 'model_names'],
    suggested_models: [
      { value: 'ernie-4.0-turbo-8k', label: 'ERNIE 4.0 Turbo 8K' },
      { value: 'deepseek-v3', label: 'DeepSeek V3' },
      { value: 'deepseek-r1', label: 'DeepSeek R1' },
    ],
  },
  {
    key: 'vertex',
    name: 'Google Vertex',
    description: 'Google Vertex AI — requires GCP credentials',
    descriptionZh: 'Google Vertex AI — 需要 GCP 凭证',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'vertex',
    base_url: '',
    extra_env: '{"CLAUDE_CODE_USE_VERTEX":"1","CLOUD_ML_REGION":"us-east5","CLAUDE_CODE_SKIP_VERTEX_AUTH":"1"}',
    fields: ['extra_env'],
  },
  {
    key: 'litellm',
    name: 'LiteLLM',
    description: 'LiteLLM proxy — local or remote',
    descriptionZh: 'LiteLLM 代理 — 本地或远程',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'custom',
    base_url: 'http://localhost:4000',
    extra_env: '{}',
    fields: ['api_key', 'base_url'],
  },
  {
    key: 'gemini-image',
    name: 'Google Gemini (Image)',
    description: 'Nano Banana Pro — AI image generation by Google Gemini',
    descriptionZh: 'Nano Banana Pro — Google Gemini AI 图片生成',
    icon: <HugeiconsIcon icon={ServerStack01Icon} className="h-[18px] w-[18px] text-muted-foreground" />,
    provider_type: 'gemini-image',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    extra_env: '{"GEMINI_API_KEY":""}',
    fields: ['api_key'],
    category: 'media',
  },
];

export const GEMINI_IMAGE_MODELS = [
  { value: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2' },
  { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro' },
  { value: 'gemini-2.5-flash-image', label: 'Nano Banana' },
];

const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

export function getGeminiImageModel(provider: ApiProvider): string {
  try {
    const env = JSON.parse(provider.extra_env || '{}');
    return env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_IMAGE_MODEL;
  } catch {
    return DEFAULT_GEMINI_IMAGE_MODEL;
  }
}
