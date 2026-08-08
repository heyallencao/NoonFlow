import type { AssistantRuntime } from '../types';

const WIDGET_FENCE_RE = /```show-widget/i;
const VISUALIZATION_RE = new RegExp(
  [
    '\\bchart\\b',
    '\\bcharts\\b',
    '\\bgraph\\b',
    '\\bdiagram\\b',
    '\\bflow\\s?chart\\b',
    '\\bvisuali[sz]e\\b',
    '\\bvisuali[sz]ation\\b',
    '\\bdashboard\\b',
    '\\bplot\\b',
    '\\bbar\\s?chart\\b',
    '\\bline\\s?chart\\b',
    '\\bpie\\s?chart\\b',
    '\\bscatter\\b',
    '\\bheatmap\\b',
    '\\btimeline\\b',
    '\\bmatrix\\b',
    '\\bgantt\\b',
    '\\bmermaid\\b',
    '图表',
    '流程图',
    '可视化',
    '画图',
    '曲线图',
    '柱状图',
    '饼图',
    '趋势图',
    '对比图',
    '甘特图',
    '思维导图',
  ].join('|'),
  'i',
);

interface ShouldInjectWidgetPromptInput {
  runtime: AssistantRuntime;
  mode: string;
  generativeUISettingEnabled: boolean;
  messageContent: string;
  systemPromptAppend?: string;
  recentHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function hasVisualizationIntent(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  return WIDGET_FENCE_RE.test(normalized) || VISUALIZATION_RE.test(normalized);
}

export function shouldInjectWidgetPrompt(input: ShouldInjectWidgetPromptInput): boolean {
  if (!input.generativeUISettingEnabled) {
    return false;
  }
  // Allow widget guidance in both code/plan workflows; keep ask mode text-only.
  if (input.mode === 'ask') {
    return false;
  }

  if (hasVisualizationIntent(input.messageContent)) {
    return true;
  }
  if (input.systemPromptAppend && hasVisualizationIntent(input.systemPromptAppend)) {
    return true;
  }

  const history = input.recentHistory || [];
  const lastHistorySlice = history.slice(-4);
  for (const item of lastHistorySlice) {
    if (WIDGET_FENCE_RE.test(item.content)) {
      return true;
    }
  }

  return false;
}
