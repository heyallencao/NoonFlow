import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  AtIcon,
  BrainIcon,
  Cancel01Icon,
  CommandLineIcon,
  FileEditIcon,
  GlobalIcon,
} from '@hugeicons/core-free-icons';
import { cn } from '@/lib/utils';
import { isImeComposingEvent } from '@/lib/ime';
import { applyTextInputNavigationKeydown } from '@/lib/text-input-keyboard';
import { setStoredClaudePreference } from '@/lib/chat-preferences';
import {
  composePiModelSelection,
  PI_THINKING_LEVELS,
  splitPiModelSelection,
  type PiThinkingLevel,
} from '@/lib/pi-model-selection';
import type { AssistantModelOption, AssistantRuntime, PiModelOption, ProviderModelGroup } from '@/types';
import type { TranslationKey } from '@/i18n';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  PromptInputButton,
} from '@/components/ai-elements/prompt-input';
import {
  type CommandBadge,
  type PopoverItem,
  type PopoverMode,
} from './constants';

const CODEX_EFFORT_SEPARATOR = '::effort=';

function formatEffortLabel(effort: string): string {
  return effort === 'xhigh'
    ? 'XHigh'
    : effort.charAt(0).toUpperCase() + effort.slice(1);
}

function splitCodexModel(modelName?: string, fallbackBaseModel = ''): { baseModel: string; effort?: string } {
  const normalizedModel = (modelName || fallbackBaseModel).trim();
  if (!normalizedModel) return { baseModel: '' };
  const normalizedLower = normalizedModel.toLowerCase();
  if (normalizedLower === 'codex') {
    return { baseModel: fallbackBaseModel };
  }
  const separatorIndex = normalizedModel.lastIndexOf(CODEX_EFFORT_SEPARATOR);
  if (separatorIndex > 0) {
    const encodedEffort = normalizedModel.slice(separatorIndex + CODEX_EFFORT_SEPARATOR.length);
    try {
      const effort = decodeURIComponent(encodedEffort).trim();
      if (effort) return { baseModel: normalizedModel.slice(0, separatorIndex), effort };
    } catch {
      // Fall through to the legacy suffix parser.
    }
  }
  const suffixMatch = normalizedModel.match(/^(.*?)-(ultra|max|xhigh|high|medium|middle|low)$/i);
  if (suffixMatch && suffixMatch[1]) {
    const normalizedEffort = suffixMatch[2].toLowerCase();
    return {
      baseModel: suffixMatch[1],
      effort: normalizedEffort === 'middle' ? 'medium' : normalizedEffort,
    };
  }
  return { baseModel: normalizedModel };
}

function composeCodexModel(baseModel: string, effort?: string): string {
  const normalizedBaseModel = splitCodexModel(baseModel).baseModel;
  return effort
    ? `${normalizedBaseModel}${CODEX_EFFORT_SEPARATOR}${encodeURIComponent(effort)}`
    : normalizedBaseModel;
}

interface MessageInputPopoverPanelProps {
  popoverMode: PopoverMode;
  allDisplayedItems: PopoverItem[];
  filteredItems: PopoverItem[];
  aiSuggestions: PopoverItem[];
  aiSearchLoading: boolean;
  fileHasMore: boolean;
  fileLoadingMore: boolean;
  selectedIndex: number;
  popoverFilter: string;
  triggerPos: number | null;
  inputValue: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  setPopoverFilter: (value: string) => void;
  setInputValue: (value: string) => void;
  onInsertItem: (item: PopoverItem) => void;
  onClosePopover: () => void;
  onLoadMoreFiles: () => void;
  t: (key: TranslationKey) => string;
}

export function MessageInputPopoverPanel({
  popoverMode,
  allDisplayedItems,
  filteredItems,
  aiSuggestions,
  aiSearchLoading,
  fileHasMore,
  fileLoadingMore,
  selectedIndex,
  popoverFilter,
  triggerPos,
  inputValue,
  textareaRef,
  setSelectedIndex,
  setPopoverFilter,
  setInputValue,
  onInsertItem,
  onClosePopover,
  onLoadMoreFiles,
  t,
}: MessageInputPopoverPanelProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverMode) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClosePopover();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverMode, onClosePopover]);

  if (!popoverMode || (allDisplayedItems.length === 0 && !aiSearchLoading)) {
    return null;
  }

  const builtInItems = filteredItems.filter(item => item.builtIn);
  const projectItems = filteredItems.filter(item => !item.builtIn && item.source === 'project');
  const skillItems = filteredItems.filter(item => !item.builtIn && item.source !== 'project');

  const renderItem = (item: PopoverItem, idx: number) => (
    <button
      key={`${idx}-${item.value}`}
      ref={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
        idx === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-white/[0.04]'
      )}
      onClick={() => onInsertItem(item)}
      onMouseEnter={() => setSelectedIndex(idx)}
    >
      {popoverMode === 'file' ? (
        <HugeiconsIcon icon={AtIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : item.builtIn && item.icon ? (
        <HugeiconsIcon icon={item.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : !item.builtIn && item.source === 'project' ? (
        <HugeiconsIcon icon={FileEditIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : !item.builtIn ? (
        <HugeiconsIcon icon={GlobalIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <HugeiconsIcon icon={CommandLineIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span
        className="font-mono text-xs truncate min-w-0 flex-1"
        title={popoverMode === 'file' ? item.value : item.label}
      >
        {popoverMode === 'file' ? item.value : item.label}
      </span>
      {popoverMode !== 'file' && (item.descriptionKey || item.description) && (
        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
          {item.descriptionKey ? t(item.descriptionKey) : item.description}
        </span>
      )}
      {!item.builtIn && item.installedSource && (
        <span className="text-xs text-muted-foreground shrink-0 ml-auto">
          {item.installedSource === 'claude' ? 'Personal' : 'Agents'}
        </span>
      )}
    </button>
  );

  let globalIdx = 0;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border bg-popover shadow-lg overflow-hidden z-50"
    >
      {popoverMode === 'skill' ? (
        <div className="px-3 py-2 border-b">
          <input
            type="text"
            placeholder="Search..."
            value={popoverFilter}
            onChange={(e) => {
              const val = e.target.value;
              setPopoverFilter(val);
              setSelectedIndex(0);
              // Sync textarea: replace the filter portion after /
              if (triggerPos !== null) {
                const before = inputValue.slice(0, triggerPos + 1);
                setInputValue(before + val);
              }
            }}
            onKeyDown={(e) => {
              const imeComposing = isImeComposingEvent(e);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % allDisplayedItems.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + allDisplayedItems.length) % allDisplayedItems.length);
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (e.key === 'Enter' && imeComposing) {
                  return;
                }
                e.preventDefault();
                if (allDisplayedItems[selectedIndex]) {
                  onInsertItem(allDisplayedItems[selectedIndex]);
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClosePopover();
                textareaRef.current?.focus();
              } else {
                applyTextInputNavigationKeydown(e);
              }
            }}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            autoFocus
          />
        </div>
      ) : (
        <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
          Files
        </div>
      )}
      <div className="max-h-48 overflow-y-auto py-1">
        {popoverMode === 'file' ? (
          <>
            {filteredItems.map((item, i) => renderItem(item, i))}
            {fileHasMore && (
              <div className="px-2 pt-1.5 pb-1">
                <button
                  type="button"
                  className="w-full rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={onLoadMoreFiles}
                  disabled={fileLoadingMore}
                >
                  {fileLoadingMore ? 'Loading...' : 'Load more files'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {builtInItems.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Commands
                </div>
                {builtInItems.map((item) => {
                  const idx = globalIdx++;
                  return renderItem(item, idx);
                })}
              </>
            )}
            {projectItems.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Project Commands
                </div>
                {projectItems.map((item) => {
                  const idx = globalIdx++;
                  return renderItem(item, idx);
                })}
              </>
            )}
            {skillItems.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Skills
                </div>
                {skillItems.map((item) => {
                  const idx = globalIdx++;
                  return renderItem(item, idx);
                })}
              </>
            )}
            {(aiSuggestions.length > 0 || aiSearchLoading) && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <HugeiconsIcon icon={BrainIcon} className="h-3.5 w-3.5" />
                  {t('messageInput.aiSuggested')}
                  {aiSearchLoading && (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  )}
                </div>
                {aiSuggestions.map((item) => {
                  const idx = globalIdx++;
                  return renderItem(item, idx);
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface CommandBadgePillProps {
  badge: CommandBadge;
  onRemove: () => void;
}

export function CommandBadgePill({ badge, onRemove }: CommandBadgePillProps) {
  const isSkill = badge.isSkill;
  const kindLabel = isSkill ? 'Skill' : 'Command';
  const kindIcon = isSkill ? BrainIcon : CommandLineIcon;
  const mainText = isSkill ? badge.label : badge.command;
  const detailText = badge.description.trim();
  const sourceText = isSkill && badge.installedSource
    ? (badge.installedSource === 'claude' ? 'Personal' : 'Agents')
    : '';

  const infoNode = (
    <div className="min-w-0 inline-flex items-center gap-2.5">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
          isSkill
            ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
            : 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
        )}
      >
        <HugeiconsIcon icon={kindIcon} className="h-3 w-3" />
        {kindLabel}
      </span>
      <span className="font-mono text-xs truncate max-w-[24rem]">{mainText}</span>
      {sourceText && (
        <span className="rounded-md border border-current/20 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {sourceText}
        </span>
      )}
    </div>
  );

  return (
    <div
      className="order-first max-w-full self-start px-3 pt-2.5 pb-0"
      style={{ flex: '0 0 auto', width: 'max-content', maxWidth: '100%' }}
    >
      <div
        style={{ flex: '0 0 auto', width: 'max-content', maxWidth: '100%' }}
        className={cn(
          'inline-flex flex-none max-w-full items-center gap-2 rounded-xl border px-2 py-1 text-xs font-medium',
          isSkill
            ? 'border-sky-500/35 bg-gradient-to-r from-sky-500/18 via-blue-500/14 to-indigo-500/12 text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_0_0_1px_rgba(56,189,248,0.12)] dark:text-sky-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(56,189,248,0.18)]'
            : 'border-blue-500/25 bg-gradient-to-r from-blue-500/10 to-indigo-500/8 text-blue-700 dark:text-blue-300'
        )}
      >
        {detailText ? (
          <HoverCard openDelay={120} closeDelay={700}>
            <HoverCardTrigger asChild>
              <div className="inline-flex min-w-0 cursor-help">{infoNode}</div>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              align="start"
              className="z-[120] w-[min(36rem,calc(100vw-2rem))] max-w-[36rem] whitespace-pre-wrap break-words p-3 text-[11px] leading-relaxed"
            >
              {detailText}
            </HoverCardContent>
          </HoverCard>
        ) : (
          infoNode
        )}
        <button
          type="button"
          onClick={onRemove}
          className={cn(
            'shrink-0 rounded-md p-1 transition-colors',
            isSkill ? 'hover:bg-sky-500/25' : 'hover:bg-blue-500/20'
          )}
          aria-label={isSkill ? 'Remove selected skill' : 'Remove selected command'}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

interface MessageModeToggleProps {
  mode: string;
  onModeChange?: (mode: string) => void;
  t: (key: TranslationKey) => string;
}

export function MessageModeToggle({ mode, onModeChange, t }: MessageModeToggleProps) {
  const isPlanMode = mode === 'plan';
  const currentLabel = isPlanMode ? t('messageInput.modePlan') : t('messageInput.modeCode');

  return (
    <PromptInputButton
      className={cn(
        'gap-1.5 rounded-full border border-transparent px-2.5 text-foreground/74 hover:border-border/62 hover:bg-foreground/[0.07] hover:text-foreground/94',
        isPlanMode
          ? 'border-border/75 bg-foreground/[0.1] text-foreground'
          : 'text-foreground/74'
      )}
      onClick={() => onModeChange?.(isPlanMode ? 'code' : 'plan')}
      tooltip={currentLabel}
    >
      <HugeiconsIcon icon={isPlanMode ? BrainIcon : FileEditIcon} className="h-3.5 w-3.5" />
      <span className="text-xs font-medium">{currentLabel}</span>
    </PromptInputButton>
  );
}

interface ModelSelectorProps {
  assistantRuntime: AssistantRuntime;
  isClaudeRuntime: boolean;
  modelName?: string;
  currentModelValue: string;
  currentProviderIdValue: string;
  currentModelLabel: string;
  providerGroups: ProviderModelGroup[];
  codexModels: AssistantModelOption[];
  codexModelsError?: string;
  piModels: PiModelOption[];
  piModelsError?: string;
  onModelChange?: (model: string) => void;
  onProviderModelChange?: (providerId: string, model: string) => void;
}

export function ModelSelector({
  assistantRuntime,
  isClaudeRuntime,
  modelName,
  currentModelValue,
  currentProviderIdValue,
  currentModelLabel,
  providerGroups,
  codexModels,
  codexModelsError,
  piModels,
  piModelsError,
  onModelChange,
  onProviderModelChange,
}: ModelSelectorProps) {
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const defaultCodexModel = codexModels.find((model) => model.isDefault)?.value || codexModels[0]?.value || '';
  const codexModel = splitCodexModel(modelName, defaultCodexModel);
  const piModel = splitPiModelSelection(currentModelValue);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelMenuOpen]);

  const handleModelSelect = useCallback((providerModelId: string, nextModel: string) => {
    onModelChange?.(nextModel);
    onProviderModelChange?.(providerModelId, nextModel);
    setStoredClaudePreference(nextModel, providerModelId);
    setModelMenuOpen(false);
  }, [onModelChange, onProviderModelChange]);

  if (assistantRuntime === 'pi') {
    return (
      <div className="relative" ref={modelMenuRef}>
        <PromptInputButton
          className={cn(
            'rounded-full border border-transparent text-foreground/74 hover:border-border/62 hover:bg-foreground/[0.07] hover:text-foreground/94',
            modelMenuOpen && 'border-border/75 bg-foreground/[0.1] text-foreground'
          )}
          onClick={() => setModelMenuOpen((prev) => !prev)}
          tooltip={piModelsError || 'Choose a provider-scoped Pi model'}
        >
          <span className="max-w-44 truncate text-xs font-medium">{piModel.model || 'Pi default'}</span>
          <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-2.5 w-2.5 transition-transform duration-200', modelMenuOpen && 'rotate-180')} />
        </PromptInputButton>
        {modelMenuOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-1.5 max-h-80 w-72 overflow-y-auto rounded-lg border border-border/70 bg-popover shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
            <div className="border-b border-border/65 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              Pi Models · provider/model
            </div>
            {piModels.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {piModelsError || 'No configured Pi models. Run pi and use /login or /model.'}
              </div>
            ) : (
              <div className="py-0.5">
                {piModels.map((option) => {
                  const value = option.value || `${option.provider}/${option.id}`;
                  const isActive = value === piModel.model;
                  return (
                    <button
                      key={value}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-3 py-1.5 text-left transition-colors',
                        isActive ? 'border-primary/25 bg-accent/62 text-foreground' : 'text-foreground/84 hover:bg-accent/45 hover:text-foreground'
                      )}
                      onClick={() => {
                        onModelChange?.(composePiModelSelection(value, piModel.thinkingLevel));
                        setModelMenuOpen(false);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">{value}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {option.contextWindow ? `${option.contextWindow.toLocaleString()} ctx` : 'context unknown'}
                          {option.reasoning ? ' · reasoning' : ''}{option.images ? ' · images' : ''}
                        </span>
                      </span>
                      {isActive && <span className="text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!isClaudeRuntime) {
    const codexOptions = codexModel.baseModel && !codexModels.some((option) => option.value === codexModel.baseModel)
      ? [...codexModels, { value: codexModel.baseModel, label: codexModel.baseModel }]
      : codexModels;
    const selectedOption = codexOptions.find((option) => option.value === codexModel.baseModel);

    return (
      <div className="relative" ref={modelMenuRef}>
        <PromptInputButton
          className={cn(
            'rounded-full border border-transparent text-foreground/74 hover:border-border/62 hover:bg-foreground/[0.07] hover:text-foreground/94',
            modelMenuOpen && 'border-border/75 bg-foreground/[0.1] text-foreground'
          )}
          onClick={() => setModelMenuOpen((prev) => !prev)}
        >
          <span className="max-w-44 truncate text-xs font-medium">
            {selectedOption?.label || codexModel.baseModel || 'Codex CLI default'}
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-2.5 w-2.5 transition-transform duration-200', modelMenuOpen && 'rotate-180')} />
        </PromptInputButton>

        {modelMenuOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-1.5 w-56 overflow-hidden rounded-lg border border-border/70 bg-popover shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
            <div className="border-b border-border/65 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
              Codex Models
            </div>
            {codexOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {codexModelsError || 'No models returned by Codex CLI. Native default will be used.'}
              </div>
            ) : (
            <div className="py-0.5">
              {codexOptions.map((option) => {
                const isActive = option.value === codexModel.baseModel;
                return (
                  <button
                    key={`codex-${option.value}`}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-3 py-1.5 text-left text-sm transition-colors',
                      isActive ? 'border-primary/25 bg-accent/62 text-foreground' : 'text-foreground/84 hover:bg-accent/45 hover:text-foreground'
                    )}
                    onClick={() => {
                      const supportedEfforts = option.supportedEffortLevels || [];
                      const nextEffort = codexModel.effort && supportedEfforts.includes(codexModel.effort)
                        ? codexModel.effort
                        : undefined;
                      const nextModel = composeCodexModel(option.value, nextEffort);
                      onModelChange?.(nextModel);
                      setModelMenuOpen(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{option.label}</span>
                      {option.description && (
                        <span className="block truncate text-[10px] text-muted-foreground">{option.description}</span>
                      )}
                    </span>
                    {isActive && <span className="text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={modelMenuRef}>
      <PromptInputButton
        className={cn(
          'rounded-full border border-transparent text-foreground/74 hover:border-border/62 hover:bg-foreground/[0.07] hover:text-foreground/94',
          modelMenuOpen && 'border-border/75 bg-foreground/[0.1] text-foreground'
        )}
        onClick={() => setModelMenuOpen((prev) => !prev)}
      >
        <span className="text-xs font-medium">{currentModelLabel}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-2.5 w-2.5 transition-transform duration-200', modelMenuOpen && 'rotate-180')} />
      </PromptInputButton>

      {modelMenuOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 max-h-80 w-52 overflow-y-auto rounded-lg border border-border/70 bg-popover shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
          {providerGroups.map((group, groupIdx) => (
            <div key={group.provider_id}>
              <div className={cn(
                'px-3 py-1.5 text-[10px] font-medium text-muted-foreground',
                groupIdx > 0 && 'border-t border-border/65'
              )}>
                {group.provider_name}
              </div>
              <div className="py-0.5">
                {group.models.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    {group.error || 'No models returned by Claude Code CLI. Native default will be used.'}
                  </div>
                )}
                {group.models.map((opt) => {
                  const isActive = opt.value === currentModelValue && group.provider_id === currentProviderIdValue;
                  return (
                    <button
                      key={`${group.provider_id}-${opt.value}`}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-3 py-1.5 text-left text-sm transition-colors',
                        isActive ? 'border-primary/25 bg-accent/62 text-foreground' : 'text-foreground/84 hover:bg-accent/45 hover:text-foreground'
                      )}
                      onClick={() => handleModelSelect(group.provider_id, opt.value)}
                    >
                      <span className="text-xs font-medium">{opt.label}</span>
                      {isActive && <span className="text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface CodexEffortSelectorProps {
  modelName?: string;
  codexModels: AssistantModelOption[];
  onModelChange?: (model: string) => void;
}

export function CodexEffortSelector({ modelName, codexModels, onModelChange }: CodexEffortSelectorProps) {
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const defaultModel = codexModels.find((model) => model.isDefault)?.value || codexModels[0]?.value || '';
  const codexModel = splitCodexModel(modelName, defaultModel);
  const selectedModel = codexModels.find((model) => model.value === codexModel.baseModel);
  const effortOptions = selectedModel?.supportedEffortLevels || [];

  useEffect(() => {
    if (!effortMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (effortMenuRef.current && !effortMenuRef.current.contains(e.target as Node)) {
        setEffortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [effortMenuOpen]);

  if (!selectedModel || effortOptions.length === 0) return null;
  const effectiveEffort = codexModel.effort || selectedModel.defaultEffort || effortOptions[0];
  const currentEffortLabel = effectiveEffort ? formatEffortLabel(effectiveEffort) : 'CLI default';

  return (
    <div className="relative" ref={effortMenuRef}>
      <PromptInputButton
        className={cn(
          'rounded-full border border-transparent text-foreground/74 hover:border-border/62 hover:bg-foreground/[0.07] hover:text-foreground/94',
          effortMenuOpen && 'border-border/75 bg-foreground/[0.1] text-foreground'
        )}
        onClick={() => setEffortMenuOpen((prev) => !prev)}
      >
        <span className="text-xs font-medium">{currentEffortLabel}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-2.5 w-2.5 transition-transform duration-200', effortMenuOpen && 'rotate-180')} />
      </PromptInputButton>

      {effortMenuOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-40 overflow-hidden rounded-lg border border-border/70 bg-popover shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
          <div className="border-b border-border/65 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            Effort
          </div>
          <div className="py-0.5">
            {effortOptions.map((effort) => {
              const isActive = effort === effectiveEffort;
              return (
                <button
                  key={`effort-${effort}`}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-3 py-1.5 text-left text-sm transition-colors',
                    isActive ? 'border-primary/25 bg-accent/62 text-foreground' : 'text-foreground/84 hover:bg-accent/45 hover:text-foreground'
                  )}
                  onClick={() => {
                    onModelChange?.(composeCodexModel(codexModel.baseModel, effort));
                    setEffortMenuOpen(false);
                  }}
                >
                  <span className="text-xs">{formatEffortLabel(effort)}</span>
                  {isActive && <span className="text-xs">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const PI_THINKING_OPTIONS: Array<{ value?: PiThinkingLevel; label: string }> = [
  { label: 'Native' },
  ...PI_THINKING_LEVELS.map((value) => ({
    value,
    label: value === 'xhigh' ? 'XHigh' : value.charAt(0).toUpperCase() + value.slice(1),
  })),
];

interface PiThinkingLevelSelectorProps {
  modelName?: string;
  fallbackModel: string;
  onModelChange?: (model: string) => void;
}

export function PiThinkingLevelSelector({
  modelName,
  fallbackModel,
  onModelChange,
}: PiThinkingLevelSelectorProps) {
  const thinkingMenuRef = useRef<HTMLDivElement>(null);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const selection = splitPiModelSelection(modelName || fallbackModel);

  useEffect(() => {
    if (!thinkingMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (thinkingMenuRef.current && !thinkingMenuRef.current.contains(event.target as Node)) {
        setThinkingMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [thinkingMenuOpen]);

  const currentLabel = PI_THINKING_OPTIONS.find(
    (option) => option.value === selection.thinkingLevel,
  )?.label || 'Native';

  return (
    <div className="relative" ref={thinkingMenuRef}>
      <PromptInputButton
        className={cn(
          'gap-1.5 rounded-full border border-transparent text-foreground/74 hover:border-border/62 hover:bg-foreground/[0.07] hover:text-foreground/94',
          thinkingMenuOpen && 'border-border/75 bg-foreground/[0.1] text-foreground',
        )}
        onClick={() => setThinkingMenuOpen((open) => !open)}
        tooltip="Pi thinking level"
      >
        <HugeiconsIcon icon={BrainIcon} className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{currentLabel}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn('h-2.5 w-2.5 transition-transform duration-200', thinkingMenuOpen && 'rotate-180')}
        />
      </PromptInputButton>

      {thinkingMenuOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-44 overflow-hidden rounded-lg border border-border/70 bg-popover shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
          <div className="border-b border-border/65 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            Pi Thinking Level
          </div>
          <div className="py-0.5">
            {PI_THINKING_OPTIONS.map((option) => {
              const isActive = option.value === selection.thinkingLevel;
              return (
                <button
                  key={`pi-thinking-${option.value || 'native'}`}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-3 py-1.5 text-left text-sm transition-colors',
                    isActive
                      ? 'border-primary/25 bg-accent/62 text-foreground'
                      : 'text-foreground/84 hover:bg-accent/45 hover:text-foreground',
                  )}
                  onClick={() => {
                    onModelChange?.(composePiModelSelection(selection.model, option.value));
                    setThinkingMenuOpen(false);
                  }}
                >
                  <span className="text-xs">{option.label}</span>
                  {isActive && <span className="text-xs">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
