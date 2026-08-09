'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from '@/components/ai-elements/confirmation';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { ImageGenConfirmation } from './ImageGenConfirmation';
import { BatchPlanInlinePreview } from './batch-image-gen/BatchPlanInlinePreview';
import { WidgetRenderer } from './WidgetRenderer';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import { MessageReasoning } from './MessageReasoning';
import { ChildActivityList } from './ChildActivityList';
import { PENDING_KEY, buildReferenceImages } from '@/lib/image-ref-store';
import { createWidgetTraceId } from '@/lib/widget-telemetry';
import {
  buildShowWidgetRenderPlan,
  hasWidgetProtocolCandidate,
  stripCompletedWidgetProtocolBlocks,
  stripTrailingWidgetProtocolBlocks,
} from '@/lib/widget-sanitizer';
import type { ToolUIPart } from 'ai';
import type {
  PermissionRequestEvent,
  ChildActivity,
  PlannerOutput,
  StreamingMessageBlock,
  ToolResultInfo,
  ToolUseInfo,
} from '@/types';

interface ImageGenRequest {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  referenceImages?: string[];
  useLastGenerated?: boolean;
}

function parseImageGenRequest(text: string): { beforeText: string; request: ImageGenRequest; afterText: string } | null {
  const regex = /```image-gen-request\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    let raw = match[1].trim();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      // Attempt to fix common model output issues: unescaped quotes in values
      raw = raw.replace(/"prompt"\s*:\s*"([\s\S]*?)"\s*([,}])/g, (_m, val, tail) => {
        const escaped = val.replace(/(?<!\\)"/g, '\\"');
        return `"prompt": "${escaped}"${tail}`;
      });
      json = JSON.parse(raw);
    }
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      request: {
        prompt: String(json.prompt || ''),
        aspectRatio: String(json.aspectRatio || '1:1'),
        resolution: String(json.resolution || '1K'),
        referenceImages: Array.isArray(json.referenceImages) ? json.referenceImages : undefined,
        useLastGenerated: json.useLastGenerated === true,
      },
      afterText,
    };
  } catch {
    return null;
  }
}

function parseBatchPlan(text: string): { beforeText: string; plan: PlannerOutput; afterText: string } | null {
  const regex = /```batch-plan\s*\n?([\s\S]*?)\n?\s*```/;
  const match = text.match(regex);
  if (!match) return null;
  try {
    const json = JSON.parse(match[1]);
    const beforeText = text.slice(0, match.index).trim();
    const afterText = text.slice((match.index || 0) + match[0].length).trim();
    return {
      beforeText,
      plan: {
        summary: json.summary || '',
        items: Array.isArray(json.items) ? json.items.map((item: Record<string, unknown>) => ({
          prompt: String(item.prompt || ''),
          aspectRatio: String(item.aspectRatio || '1:1'),
          resolution: String(item.resolution || '1K'),
          tags: Array.isArray(item.tags) ? item.tags : [],
          sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
        })) : [],
      },
      afterText,
    };
  } catch {
    return null;
  }
}

interface StreamingMessageProps {
  sessionId?: string;
  content: string;
  reasoning?: string;
  showReasoning?: boolean;
  generativeUIEnabled?: boolean;
  isStreaming: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingBlocks?: StreamingMessageBlock[];
  streamingToolOutput?: string;
  statusText?: string;
  startedAt?: number;
  pendingPermission?: PermissionRequestEvent | null;
  onPermissionResponse?: (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>) => void;
  permissionResolved?: 'allow' | 'deny' | null;
  onForceStop?: () => void;
  childActivities?: ChildActivity[];
}

export interface StreamingAssistantSupplementalProps {
  isStreaming: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  statusText?: string;
  startedAt?: number;
  pendingPermission?: PermissionRequestEvent | null;
  onPermissionResponse?: (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>) => void;
  permissionResolved?: 'allow' | 'deny' | null;
  onForceStop?: () => void;
  childActivities?: ChildActivity[];
}

function ElapsedTimer({ startedAt }: { startedAt?: number }) {
  const [fallbackStartedAt, setFallbackStartedAt] = useState<number | null>(null);
  const effectiveStartedAt = startedAt && startedAt > 0 ? startedAt : fallbackStartedAt;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startedAt && startedAt > 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setFallbackStartedAt((current) => current ?? Date.now());
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [startedAt]);

  useEffect(() => {
    if (!effectiveStartedAt) {
      return;
    }

    const updateElapsed = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - effectiveStartedAt) / 1000)));
    };

    const initialTimeout = window.setTimeout(updateElapsed, 0);
    const interval = window.setInterval(updateElapsed, 1000);

    return () => {
      window.clearTimeout(initialTimeout);
      window.clearInterval(interval);
    };
  }, [effectiveStartedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <span className="tabular-nums">
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
    </span>
  );
}

function AskUserQuestionUI({
  toolInput,
  onSubmit,
}: {
  toolInput: Record<string, unknown>;
  onSubmit: (decision: 'allow', updatedInput: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const questions = (toolInput.questions || []) as Array<{
    question: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect: boolean;
    header?: string;
  }>;

  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [useOther, setUseOther] = useState<Record<string, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the component when it mounts
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const toggleOption = (qIdx: string, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[qIdx] || []);
      if (multi) {
        if (current.has(label)) {
          current.delete(label);
        } else {
          current.add(label);
        }
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [qIdx]: current };
    });
    // Deselect "Other" when picking a regular option
    setUseOther((prev) => ({ ...prev, [qIdx]: false }));
  };

  const toggleOther = (qIdx: string, multi: boolean) => {
    if (!multi) {
      setSelections((prev) => ({ ...prev, [qIdx]: new Set() }));
    }
    setUseOther((prev) => ({ ...prev, [qIdx]: !prev[qIdx] }));
  };

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((q, i) => {
      const qIdx = String(i);
      const selected = Array.from(selections[qIdx] || []);
      if (useOther[qIdx] && otherTexts[qIdx]?.trim()) {
        selected.push(otherTexts[qIdx].trim());
      }
      answers[q.question] = selected.join(', ');
    });
    onSubmit('allow', { questions: toolInput.questions, answers });
  };

  const hasAnswer = questions.some((_, i) => {
    const qIdx = String(i);
    return (selections[qIdx]?.size || 0) > 0 || (useOther[qIdx] && otherTexts[qIdx]?.trim());
  });

  return (
    <div
      ref={containerRef}
      className="space-y-5 rounded-2xl border border-border-subtle/80 bg-bg-secondary/55 p-4 backdrop-blur-md shadow-[0_14px_34px_rgba(6,10,24,0.18)]"
    >
      {questions.map((q, i) => {
        const qIdx = String(i);
        const selected = selections[qIdx] || new Set<string>();
        return (
          <section
            key={qIdx}
            className="space-y-3 rounded-xl border border-border-subtle/80 bg-bg-primary/45 p-4"
          >
            {q.header && (
              <span className="inline-flex rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/90">
                {q.header}
              </span>
            )}
            <div className="space-y-1">
              <p className="text-[15px] font-semibold leading-6 text-foreground/95">{q.question}</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {q.multiSelect
                  ? t('streaming.askUserQuestion.multiSelectHint')
                  : t('streaming.askUserQuestion.singleSelectHint')}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {q.options.map((opt) => {
                const isSelected = selected.has(opt.label);
                return (
                  <button
                    key={opt.label}
                    onClick={() => toggleOption(qIdx, opt.label, q.multiSelect)}
                    className={`group flex min-h-[76px] flex-col items-start justify-between rounded-xl border px-4 py-3 text-left transition-all duration-200 ${
                      isSelected
                        ? 'border-primary/45 bg-primary/14 text-foreground shadow-[0_0_0_1px_rgba(112,146,255,0.14)]'
                        : 'border-border-subtle/80 bg-bg-primary/35 text-foreground/90 hover:border-border-default hover:bg-bg-primary/55'
                    }`}
                  >
                    <div className="flex w-full items-start justify-between gap-3">
                      <span className="text-sm font-semibold leading-5">{opt.label}</span>
                      <span
                        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                          isSelected
                            ? 'border-primary/45 bg-primary/20 text-primary-foreground'
                            : 'border-border-default text-muted-foreground'
                        }`}
                      >
                        {q.multiSelect ? (isSelected ? '✓' : '+') : isSelected ? '✓' : ''}
                      </span>
                    </div>
                    <span className={`text-xs leading-5 ${isSelected ? 'text-foreground/78' : 'text-muted-foreground'}`}>
                      {opt.description || t('streaming.askUserQuestion.optionFallback')}
                    </span>
                  </button>
                );
              })}
              <button
                onClick={() => toggleOther(qIdx, q.multiSelect)}
                className={`group flex min-h-[76px] flex-col items-start justify-between rounded-xl border px-4 py-3 text-left transition-all duration-200 ${
                  useOther[qIdx]
                    ? 'border-primary/40 bg-primary/12 text-foreground shadow-[0_0_0_1px_rgba(112,146,255,0.12)]'
                    : 'border-border-subtle/80 bg-bg-primary/35 text-foreground/90 hover:border-border-default hover:bg-bg-primary/55'
                }`}
              >
                <div className="flex w-full items-start justify-between gap-3">
                  <span className="text-sm font-semibold leading-5">{t('streaming.askUserQuestion.other')}</span>
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                      useOther[qIdx]
                        ? 'border-primary/45 bg-primary/20 text-primary-foreground'
                        : 'border-border-default text-muted-foreground'
                    }`}
                  >
                    {useOther[qIdx] ? '✓' : '…'}
                  </span>
                </div>
                <span className={`text-xs leading-5 ${useOther[qIdx] ? 'text-foreground/78' : 'text-muted-foreground'}`}>
                  {t('streaming.askUserQuestion.otherHint')}
                </span>
              </button>
            </div>
            {useOther[qIdx] && (
              <input
                type="text"
                placeholder={t('streaming.askUserQuestion.otherPlaceholder')}
                value={otherTexts[qIdx] || ''}
                onChange={(e) => setOtherTexts((prev) => ({ ...prev, [qIdx]: e.target.value }))}
                className="w-full rounded-xl border border-border-default bg-bg-primary/45 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/45 focus:outline-none focus:ring-2 focus:ring-primary/20"
                autoFocus
              />
            )}
          </section>
        );
      })}
      <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
        <p className="text-xs leading-5 text-muted-foreground">
          {t('streaming.askUserQuestion.footerHint')}
        </p>
        <button
          onClick={handleSubmit}
          disabled={!hasAnswer}
          className="inline-flex h-11 min-w-[124px] items-center justify-center rounded-xl bg-primary/92 px-5 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/84 disabled:cursor-not-allowed disabled:bg-bg-tertiary disabled:text-muted-foreground"
        >
          {t('streaming.askUserQuestion.submit')}
        </button>
      </div>
    </div>
  );
}

function ExitPlanModeUI({
  toolInput,
  onApprove,
  onDeny,
}: {
  toolInput: Record<string, unknown>;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const allowedPrompts = (toolInput.allowedPrompts || []) as Array<{
    tool: string;
    prompt: string;
  }>;

  return (
    <div className="space-y-3 rounded-2xl border border-border-subtle/80 bg-bg-secondary/55 p-4 backdrop-blur-md shadow-[0_14px_34px_rgba(6,10,24,0.18)]">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <span className="text-[15px] font-semibold leading-6 text-foreground/95">Plan complete — ready to execute</span>
      </div>
      {allowedPrompts.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-primary/45">
          <div className="border-b border-border-subtle px-3.5 py-2">
            <span className="text-xs font-medium text-muted-foreground">Requested permissions</span>
          </div>
          <ul className="space-y-0.5 px-3.5 py-2.5">
            {allowedPrompts.map((p, i) => (
              <li key={i} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
                <span className="inline-flex rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-primary/90">{p.tool}</span>
                <span className="leading-5">{p.prompt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3 mt-1">
        <button
          onClick={onDeny}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-border-default bg-bg-primary/45 px-4 text-xs font-medium text-foreground/82 transition-all duration-200 hover:bg-bg-tertiary"
        >
          Reject
        </button>
        <button
          onClick={onApprove}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-primary/92 px-4 text-xs font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/84"
        >
          Approve & Execute
        </button>
      </div>
    </div>
  );
}

function StreamingStatusBar({ statusText, startedAt, onForceStop }: { statusText?: string; startedAt?: number; onForceStop?: () => void }) {
  const displayText = statusText || 'Thinking';

  // Parse elapsed seconds from statusText like "Running bash... (45s)"
  const elapsedMatch = statusText?.match(/\((\d+)s\)/);
  const toolElapsed = elapsedMatch ? parseInt(elapsedMatch[1], 10) : 0;
  const isWarning = toolElapsed >= 60;
  const isCritical = toolElapsed >= 90;

  return (
    <div className="flex items-center gap-3 py-2 px-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className={isCritical ? 'text-red-500' : isWarning ? 'text-yellow-500' : undefined}>
          <Shimmer duration={1.5}>{displayText}</Shimmer>
        </span>
        {isWarning && !isCritical && (
          <span className="text-yellow-500 text-[10px]">Running longer than usual</span>
        )}
        {isCritical && (
          <span className="text-red-500 text-[10px]">Tool may be stuck</span>
        )}
      </div>
      <span className="text-muted-foreground/50">|</span>
      <ElapsedTimer startedAt={startedAt} />
      {onForceStop && (
        <button
          type="button"
          onClick={onForceStop}
          className={isCritical
            ? "ml-auto rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
            : "ml-auto rounded-md border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-foreground/75 transition-colors hover:bg-white/[0.04]"}
        >
          Stop
        </button>
      )}
    </div>
  );
}

function getConfirmationState(
  pendingPermission: PermissionRequestEvent | null | undefined,
  permissionResolved: 'allow' | 'deny' | null | undefined,
): ToolUIPart['state'] {
  if (permissionResolved) return 'approval-responded';
  if (pendingPermission) return 'approval-requested';
  return 'input-available';
}

function getApproval(
  pendingPermission: PermissionRequestEvent | null | undefined,
  permissionResolved: 'allow' | 'deny' | null | undefined,
) {
  if (!pendingPermission && !permissionResolved) return undefined;
  if (permissionResolved === 'allow') {
    return { id: pendingPermission?.permissionRequestId || '', approved: true as const };
  }
  if (permissionResolved === 'deny') {
    return { id: pendingPermission?.permissionRequestId || '', approved: false as const };
  }
  return { id: pendingPermission?.permissionRequestId || '' };
}

function formatToolInput(input: Record<string, unknown>): string {
  if (input.command) return String(input.command);
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  return JSON.stringify(input, null, 2);
}

function getToolSummary(toolName: string, input: Record<string, unknown>): string | null {
  if (input.command) {
    const cmd = String(input.command);
    return cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd;
  }
  if (input.file_path) {
    const fp = String(input.file_path);
    return fp.length > 80 ? '…' + fp.slice(-77) : fp;
  }
  if (input.path) {
    const p = String(input.path);
    return p.length > 80 ? '…' + p.slice(-77) : p;
  }
  if (input.pattern) return String(input.pattern);
  if (input.query) {
    const q = String(input.query);
    return q.length > 80 ? q.slice(0, 80) + '…' : q;
  }
  if (input.description) {
    const d = String(input.description);
    return d.length > 80 ? d.slice(0, 80) + '…' : d;
  }
  return null;
}

function getRunningCommandSummary(toolUses: ToolUseInfo[], toolResults: ToolResultInfo[]): string | undefined {
  const runningTools = toolUses.filter(
    (tool) => !toolResults.some((result) => result.tool_use_id === tool.id)
  );

  if (runningTools.length === 0) {
    if (toolUses.length > 0) return 'Generating response...';
    return undefined;
  }

  const tool = runningTools[runningTools.length - 1];
  const input = tool.input as Record<string, unknown>;
  const normalizedName = tool.name.trim().toLowerCase();
  const isCommandTool = normalizedName === 'bash'
    || normalizedName === 'execute'
    || normalizedName === 'run'
    || normalizedName === 'shell'
    || normalizedName === 'execute_command'
    || normalizedName === 'exec_command';
  const command = input.command || input.cmd;
  if (isCommandTool && command) {
    const cmd = String(command);
    return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
  }
  if (input.file_path) return `${tool.name}: ${String(input.file_path)}`;
  if (input.path) return `${tool.name}: ${String(input.path)}`;
  return `Running ${tool.name}...`;
}

export function StreamingAssistantSupplemental({
  isStreaming,
  toolUses = [],
  toolResults = [],
  statusText,
  startedAt,
  pendingPermission,
  onPermissionResponse,
  permissionResolved,
  onForceStop,
  childActivities = [],
}: StreamingAssistantSupplementalProps) {
  const { t } = useTranslation();
  const approval = getApproval(pendingPermission, permissionResolved);
  const confirmationState = getConfirmationState(pendingPermission, permissionResolved);
  const runningCommandSummary = getRunningCommandSummary(toolUses, toolResults);

  return (
    <>
      {pendingPermission?.toolName === 'ExitPlanMode' && !permissionResolved && (
        <ExitPlanModeUI
          toolInput={pendingPermission.toolInput as Record<string, unknown>}
          onApprove={() => onPermissionResponse?.('allow')}
          onDeny={() => onPermissionResponse?.('deny')}
        />
      )}
      {pendingPermission?.toolName === 'ExitPlanMode' && permissionResolved === 'allow' && (
        <div className="flex items-center gap-2 py-1">
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-green-400/40 bg-green-400/15">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-xs font-medium text-green-400">Plan approved — executing</p>
        </div>
      )}
      {pendingPermission?.toolName === 'ExitPlanMode' && permissionResolved === 'deny' && (
        <div className="flex items-center gap-2 py-1">
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-red-400/40 bg-red-400/15">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-red-400"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </div>
          <p className="text-xs font-medium text-red-400">Plan rejected</p>
        </div>
      )}

      {(pendingPermission || permissionResolved) && pendingPermission?.toolName !== 'AskUserQuestion' && pendingPermission?.toolName !== 'ExitPlanMode' && (
        <Confirmation approval={approval} state={confirmationState}>
          <ConfirmationTitle>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-400/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-300"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87L13.637 3.59a1.914 1.914 0 0 0-3.274 0z"/><path d="M12 17h.01"/></svg>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="inline-flex shrink-0 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200/85">
                  {pendingPermission?.toolName}
                </span>
                {pendingPermission?.toolInput && (() => {
                  const summary = getToolSummary(pendingPermission.toolName, pendingPermission.toolInput);
                  return summary ? (
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={summary}>
                      {summary}
                    </span>
                  ) : null;
                })()}
              </div>
            </div>
          </ConfirmationTitle>

          {pendingPermission && (
            <div className="overflow-hidden rounded-xl border border-white/8 bg-black/10 backdrop-blur-sm">
              <div className="max-h-28 overflow-y-auto px-3.5 py-2.5 font-mono text-xs leading-5 text-muted-foreground selection:bg-amber-500/30">
                {formatToolInput(pendingPermission.toolInput)}
              </div>
            </div>
          )}

          <ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction
                variant="outline"
                onClick={() => onPermissionResponse?.('deny')}
              >
                Deny
              </ConfirmationAction>
              <ConfirmationAction
                variant="outline"
                onClick={() => onPermissionResponse?.('allow')}
              >
                Allow Once
              </ConfirmationAction>
              {pendingPermission?.suggestions && pendingPermission.suggestions.length > 0 && (
                <ConfirmationAction
                  variant="default"
                  onClick={() => onPermissionResponse?.('allow_session')}
                >
                  {t('streaming.allowForSession')}
                </ConfirmationAction>
              )}
            </ConfirmationActions>
          </ConfirmationRequest>

          <ConfirmationAccepted>
            <div className="flex items-center gap-2 border-t border-white/8 pt-3 mt-1">
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-green-400/40 bg-green-400/15">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <p className="text-xs font-medium text-green-400">{t('streaming.allowed')}</p>
            </div>
          </ConfirmationAccepted>

          <ConfirmationRejected>
            <div className="flex items-center gap-2 border-t border-white/8 pt-3 mt-1">
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-red-400/40 bg-red-400/15">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-red-400"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </div>
              <p className="text-xs font-medium text-red-400">{t('streaming.denied')}</p>
            </div>
          </ConfirmationRejected>
        </Confirmation>
      )}

      {pendingPermission?.toolName === 'AskUserQuestion' && !permissionResolved && (
        <AskUserQuestionUI
          toolInput={pendingPermission.toolInput as Record<string, unknown>}
          onSubmit={(decision, updatedInput) => onPermissionResponse?.(decision, updatedInput)}
        />
      )}
      {pendingPermission?.toolName === 'AskUserQuestion' && permissionResolved && (
        <div className="flex items-center gap-2 py-1">
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-green-400/40 bg-green-400/15">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-xs font-medium text-green-400">Answer submitted</p>
        </div>
      )}

      <ChildActivityList activities={childActivities} />

      {isStreaming && (
        <StreamingStatusBar
          statusText={
            pendingPermission && !permissionResolved
              ? `Waiting for authorization: ${pendingPermission.toolName}`
              : statusText || runningCommandSummary
          }
          startedAt={startedAt}
          onForceStop={onForceStop}
        />
      )}
    </>
  );
}

export function StreamingMessage({
  sessionId,
  content,
  reasoning = '',
  showReasoning = false,
  generativeUIEnabled = true,
  isStreaming,
  toolUses = [],
  toolResults = [],
  streamingBlocks = [],
  streamingToolOutput,
  statusText,
  startedAt,
  pendingPermission,
  onPermissionResponse,
  permissionResolved,
  onForceStop,
  childActivities = [],
}: StreamingMessageProps) {
  const { t } = useTranslation();
  const batchPlanMessageId = useId();

  const toolMap = useMemo(() => {
    const map = new Map<string, ToolUseInfo>();
    for (const tool of toolUses) {
      map.set(tool.id, tool);
    }
    return map;
  }, [toolUses]);

  const toolResultMap = useMemo(() => {
    const map = new Map<string, ToolResultInfo>();
    for (const result of toolResults) {
      map.set(result.tool_use_id, result);
    }
    return map;
  }, [toolResults]);

  const orderedBlocks = useMemo(() => {
    if (streamingBlocks.length > 0) {
      return streamingBlocks;
    }

    const fallback: StreamingMessageBlock[] = [];
    if (reasoning.trim()) {
      fallback.push({
        id: 'fallback-reasoning',
        type: 'reasoning',
        text: reasoning,
      });
    }
    for (const tool of toolUses) {
      fallback.push({
        id: `fallback-tool-${tool.id}`,
        type: 'tool',
        tool_use_id: tool.id,
      });
    }
    if (content.trim()) {
      fallback.push({
        id: 'fallback-text',
        type: 'text',
        text: content,
      });
    }
    return fallback;
  }, [content, reasoning, streamingBlocks, toolUses]);

  const renderedToolIds = useMemo(() => {
    const ids = new Set<string>();
    for (const block of orderedBlocks) {
      if (block.type === 'tool') {
        ids.add(block.tool_use_id);
      }
    }
    return ids;
  }, [orderedBlocks]);

  const trailingTools = useMemo(
    () => toolUses.filter((tool) => !renderedToolIds.has(tool.id)),
    [renderedToolIds, toolUses],
  );
  const streamingWidgetTraceId = useMemo(
    () => createWidgetTraceId(`${sessionId || 'streaming'}:stream`),
    [sessionId],
  );

  const getBlockWrapperClass = useCallback(
    (
      type: 'tool' | 'text' | 'reasoning',
      prevType: 'tool' | 'text' | 'reasoning' | null,
    ) => {
      const spacing = !prevType
        ? ''
        : type === 'reasoning'
          ? (prevType === 'text' ? 'mt-4' : 'mt-3')
          : type === 'tool'
            ? (prevType === 'text' ? 'mt-2.5' : 'mt-1.5')
            : (prevType === 'reasoning' ? 'mt-4' : 'mt-3');

      const inset = type === 'text' ? 'pl-[1.35rem]' : '';
      const rail = type === 'tool' || type === 'reasoning'
        ? 'border-l border-border/35 pl-3'
        : '';

      return `${spacing} ${rail} ${inset}`.trim();
    },
    [],
  );

  const renderStreamingText = (textValue: string, liveStreamingBlock: boolean) => {
    if (!textValue) {
      return null;
    }

    const hasShowWidget = generativeUIEnabled && hasWidgetProtocolCandidate(textValue);
    if (hasShowWidget) {
      const traceId = streamingWidgetTraceId;
      const widgetPlan = buildShowWidgetRenderPlan(textValue, {
        liveStreaming: liveStreamingBlock,
        telemetry: {
          sessionId,
          messageId: 'streaming',
          traceId,
        },
      });

      if (widgetPlan.widgetCount > 0 || widgetPlan.hasIncompleteWidget || widgetPlan.hasMalformedWidget) {
        return (
          <>
            {widgetPlan.hasMalformedWidget && (
              <div
                className="my-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground/90"
                data-widget-invalid="true"
              >
                {t('widget.invalid')}
              </div>
            )}
            {widgetPlan.parts.map((part, index) => (
              part.type === 'text'
                ? (
                    /\S/.test(part.text)
                      ? <MessageResponse key={`widget-text-${index}`}>{part.text}</MessageResponse>
                      : null
                  )
                : (
                  <WidgetErrorBoundary
                      key={`${part.key}-${index}`}
                      fallbackLabel={t('widget.fallback')}
                      sessionId={sessionId}
                      messageId="streaming"
                      traceId={traceId}
                    >
                    <WidgetRenderer
                        widgetKey={part.key}
                        title={part.title}
                        widgetCode={part.widgetCode}
                        isStreaming={liveStreamingBlock}
                        sessionId={sessionId}
                        messageId="streaming"
                        traceId={traceId}
                        className="my-2"
                      />
                    </WidgetErrorBoundary>
                )
            ))}
            {widgetPlan.hasIncompleteWidget && (
              <Shimmer>{t('widget.streaming')}</Shimmer>
            )}
          </>
        );
      }
    }

    const batchPlanResult = parseBatchPlan(textValue);
    if (batchPlanResult) {
      return (
        <>
          {batchPlanResult.beforeText && <MessageResponse>{batchPlanResult.beforeText}</MessageResponse>}
          <BatchPlanInlinePreview plan={batchPlanResult.plan} messageId={`streaming-${batchPlanMessageId}`} />
          {batchPlanResult.afterText && <MessageResponse>{batchPlanResult.afterText}</MessageResponse>}
        </>
      );
    }

    const parsed = parseImageGenRequest(textValue);
    if (parsed) {
      const refs = buildReferenceImages(
        PENDING_KEY,
        parsed.request.useLastGenerated || false,
        parsed.request.referenceImages,
      );
      return (
        <>
          {parsed.beforeText && <MessageResponse>{parsed.beforeText}</MessageResponse>}
          <ImageGenConfirmation
            initialPrompt={parsed.request.prompt}
            initialAspectRatio={parsed.request.aspectRatio}
            initialResolution={parsed.request.resolution}
            referenceImages={refs.length > 0 ? refs : undefined}
          />
          {parsed.afterText && <MessageResponse>{parsed.afterText}</MessageResponse>}
        </>
      );
    }

    if (liveStreamingBlock) {
      const hasImageGenBlock = /```image-gen-request/.test(textValue);
      const hasBatchPlanBlock = /```batch-plan/.test(textValue);
      const hasWidgetBlock = generativeUIEnabled && hasWidgetProtocolCandidate(textValue);
      let stripped = textValue
        .replace(/```image-gen-request[\s\S]*$/, '')
        .replace(/```batch-plan[\s\S]*$/, '')
        .trim();
      if (generativeUIEnabled) {
        stripped = stripTrailingWidgetProtocolBlocks(stripped).trim();
      }
      if (stripped) {
        return <MessageResponse>{stripped}</MessageResponse>;
      }
      if (hasImageGenBlock || hasBatchPlanBlock || hasWidgetBlock) {
        return <Shimmer>{t('streaming.thinking')}</Shimmer>;
      }
      return null;
    }

    const stripped = textValue
      .replace(/```image-gen-request[\s\S]*?```/g, '')
      .replace(/```batch-plan[\s\S]*?```/g, '')
      .trim();
    const finalStripped = generativeUIEnabled
      ? stripCompletedWidgetProtocolBlocks(stripped).trim()
      : stripped;
    return finalStripped ? <MessageResponse>{finalStripped}</MessageResponse> : null;
  };

  return (
    <AIMessage from="assistant">
      <MessageContent>
        {orderedBlocks.map((block, index) => {
          const prevType = index > 0 ? orderedBlocks[index - 1]?.type ?? null : null;
          const wrapperClass = getBlockWrapperClass(block.type, prevType);

          if (block.type === 'reasoning') {
            if (!showReasoning || !block.text.trim()) {
              return null;
            }
            return (
              <div key={block.id} className={wrapperClass}>
                <MessageReasoning
                  content={block.text}
                  isStreaming={isStreaming && index === orderedBlocks.length - 1}
                />
              </div>
            );
          }

          if (block.type === 'tool') {
            const tool = toolMap.get(block.tool_use_id);
            const result = toolResultMap.get(block.tool_use_id);
            if (!tool && !result) {
              return null;
            }
            return (
              <div key={block.id} className={wrapperClass}>
                <ToolActionsGroup
                  tools={[{
                    id: block.tool_use_id,
                    name: tool?.name || 'tool',
                    input: tool?.input ?? {},
                    result: result?.content,
                    isError: result?.is_error,
                  }]}
                  isStreaming={isStreaming}
                  streamingToolOutput={streamingToolOutput}
                />
              </div>
            );
          }

          if (block.type === 'text') {
            return (
              <div key={block.id} className={wrapperClass}>
                {renderStreamingText(
                  block.text,
                  isStreaming && index === orderedBlocks.length - 1,
                )}
              </div>
            );
          }

          return null;
        })}

        {trailingTools.map((tool) => {
          const result = toolResultMap.get(tool.id);
          return (
            <ToolActionsGroup
              key={`fallback-tool-${tool.id}`}
              tools={[{
                id: tool.id,
                name: tool.name,
                input: tool.input,
                result: result?.content,
                isError: result?.is_error,
              }]}
              isStreaming={isStreaming}
              streamingToolOutput={streamingToolOutput}
            />
          );
        })}

        {/* Loading indicator when no content yet */}
        {isStreaming && orderedBlocks.length === 0 && !pendingPermission && !(showReasoning && reasoning) && (
          <div className="py-2">
            <Shimmer>{t('streaming.thinking')}</Shimmer>
          </div>
        )}

        <StreamingAssistantSupplemental
          isStreaming={isStreaming}
          toolUses={toolUses}
          toolResults={toolResults}
          streamingToolOutput={streamingToolOutput}
          statusText={statusText}
          startedAt={startedAt}
          pendingPermission={pendingPermission}
          onPermissionResponse={onPermissionResponse}
          permissionResolved={permissionResolved}
          onForceStop={onForceStop}
          childActivities={childActivities}
        />
      </MessageContent>
    </AIMessage>
  );
}
