'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CommandLineIcon } from '@hugeicons/core-free-icons';
import type { ChatStatus } from 'ai';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useImageGen } from '@/hooks/useImageGen';
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { subscribeProviderChanged } from '@/lib/events/app-event-bus';
import { usePiModelsQuery, useProviderModelsQuery } from '@/lib/queries/provider-queries';
import type { CommandBadge } from './message-input/constants';
import { DEFAULT_MODEL_OPTIONS } from './message-input/constants';
import {
  AttachFileButton,
  FileAttachmentsCapsules,
  FileAwareSubmitButton,
  FileTreeAttachmentBridge,
} from './message-input/helpers';
import {
  CodexEffortSelector,
  CommandBadgePill,
  MessageInputPopoverPanel,
  MessageModeToggle,
  ModelSelector,
  PiThinkingLevelSelector,
} from './message-input/panels';
import { splitPiModelSelection } from '@/lib/pi-model-selection';
import { useInsertPathSubscription } from './message-input/hooks/use-insert-path-subscription';
import { useKeydownHandler } from './message-input/hooks/use-keydown-handler';
import { usePopoverController } from './message-input/hooks/use-popover-controller';
import { useSessionInputState } from './message-input/hooks/use-session-input-state';
import { useSubmitHandler } from './message-input/hooks/use-submit-handler';
import type { MessageInputProps } from './message-input/types';
import type { ProviderModelGroup } from '@/types';

export function MessageInput({
  onSend,
  onCommand,
  onStop,
  disabled,
  isStreaming,
  sessionId,
  modelName,
  onModelChange,
  providerId,
  onProviderModelChange,
  assistantRuntime = 'claude_code',
  workingDirectory,
  mode = 'code',
  onModeChange,
  terminalOpen,
  onToggleTerminal,
  showQuickSkills = false,
  containerRef,
}: MessageInputProps) {
  const { t } = useTranslation();
  const imageGen = useImageGen();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [badge, setBadge] = useState<CommandBadge | null>(null);

  const {
    inputValue,
    setInputValue,
    historyIndex,
    setHistoryIndex,
    historyDraftBeforeNavigation,
    setHistoryDraftBeforeNavigation,
    clearHistoryNavigationState,
    commitInputToHistory,
  } = useSessionInputState(sessionId);

  const popover = usePopoverController({
    inputValue,
    setInputValue,
    historyIndex,
    clearHistoryNavigationState,
    modelName,
    onCommand,
    setBadge,
    textareaRef,
    workingDirectory,
  });

  const providerModelsQuery = useProviderModelsQuery();
  const piModelsQuery = usePiModelsQuery(assistantRuntime === 'pi');

  useEffect(() => {
    const unsubscribe = subscribeProviderChanged(() => {
      void providerModelsQuery.refetch();
    });
    return unsubscribe;
  }, [providerModelsQuery]);

  useInsertPathSubscription({
    inputValue,
    setInputValue,
    textareaRef,
  });

  const removeBadge = useCallback(() => {
    setBadge(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const handleSubmit = useSubmitHandler({
    onSend,
    onCommand,
    disabled,
    isStreaming,
    badge,
    setBadge,
    imageGen,
    workingDirectory,
    closePopover: popover.closePopover,
    setInputValue,
    commitInputToHistory,
  });

  const handleKeyDown = useKeydownHandler({
    popoverMode: popover.popoverMode,
    popoverItems: popover.popoverItems,
    allDisplayedItems: popover.allDisplayedItems,
    selectedIndex: popover.selectedIndex,
    setSelectedIndex: popover.setSelectedIndex,
    insertItem: popover.insertItem,
    closePopover: popover.closePopover,
    badgeActive: !!badge,
    inputValue,
    removeBadge,
    sessionId,
    historyIndex,
    historyDraftBeforeNavigation,
    setInputValue,
    setHistoryIndex,
    setHistoryDraftBeforeNavigation,
    textareaRef,
  });

  const providerGroups: ProviderModelGroup[] =
    providerModelsQuery.data?.groups && providerModelsQuery.data.groups.length > 0
      ? providerModelsQuery.data.groups
      : [{
          provider_id: 'env',
          provider_name: 'Anthropic',
          provider_type: 'anthropic',
          models: DEFAULT_MODEL_OPTIONS,
        }];

  const defaultProviderId = providerModelsQuery.data?.default_provider_id || '';
  const currentProviderIdValue = providerId || defaultProviderId || (providerGroups[0]?.provider_id ?? '');
  const currentGroup = providerGroups.find((group) => group.provider_id === currentProviderIdValue) || providerGroups[0];
  const modelOptions = currentGroup?.models || DEFAULT_MODEL_OPTIONS;
  const fallbackClaudeModel = modelOptions[0]?.value || DEFAULT_MODEL_OPTIONS[0].value;

  const isClaudeRuntime = assistantRuntime === 'claude_code';
  const currentModelValue = modelName || (isClaudeRuntime
    ? fallbackClaudeModel
    : assistantRuntime === 'pi'
      ? piModelsQuery.data?.default_model || piModelsQuery.data?.models[0]?.value || ''
      : 'codex');
  const currentModelOption = modelOptions.find((model) => model.value === currentModelValue) || modelOptions[0];
  const piModelSelection = splitPiModelSelection(currentModelValue);
  const selectedPiModel = piModelsQuery.data?.models.find((model) => (
    (model.value || `${model.provider}/${model.id}`) === piModelSelection.model
  ));
  const chatStatus: ChatStatus = isStreaming ? 'streaming' : 'ready';
  const showQuickSkillCards = showQuickSkills && !badge && !inputValue.trim();
  const quickSkillCards = [
    {
      key: 'analyze',
      title: t('messageInput.quickSkillAnalyzeTitle'),
      hint: t('messageInput.quickSkillAnalyzeHint'),
      prompt: t('messageInput.quickSkillAnalyzePrompt'),
      dotClass: 'bg-info',
    },
    {
      key: 'review',
      title: t('messageInput.quickSkillReviewTitle'),
      hint: t('messageInput.quickSkillReviewHint'),
      prompt: t('messageInput.quickSkillReviewPrompt'),
      dotClass: 'bg-warning',
    },
    {
      key: 'doc',
      title: t('messageInput.quickSkillDocTitle'),
      hint: t('messageInput.quickSkillDocHint'),
      prompt: t('messageInput.quickSkillDocPrompt'),
      dotClass: 'bg-success',
    },
  ] as const;

  return (
    <div ref={containerRef} data-testid="chat-message-input" className="px-4 pb-6 pt-2">
      <div className="mx-auto w-full max-w-[960px]">
        <div className="relative">
          {showQuickSkillCards && (
            <div className="mb-3">
              <div className="mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground/72">
                {t('messageInput.quickSkillsTitle')}
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {quickSkillCards.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="group flex flex-col items-center justify-center gap-0.5 rounded-md border border-border/55 bg-bg-primary/28 px-3 py-2 text-center transition-colors hover:border-border/78 hover:bg-bg-primary/42 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                    onClick={() => {
                      setInputValue(item.prompt);
                      setTimeout(() => textareaRef.current?.focus(), 0);
                    }}
                  >
                    <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-1.5">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', item.dotClass)} />
                      <span className="truncate text-[12px] font-medium text-foreground/90">{item.title}</span>
                    </span>
                    <span className="block w-full truncate text-[11px] leading-4 text-muted-foreground/85 group-hover:text-foreground/72">
                      {item.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <MessageInputPopoverPanel
            popoverMode={popover.popoverMode}
            allDisplayedItems={popover.allDisplayedItems}
            filteredItems={popover.filteredItems}
            aiSuggestions={popover.aiSuggestions}
            aiSearchLoading={popover.aiSearchLoading}
            selectedIndex={popover.selectedIndex}
            popoverFilter={popover.popoverFilter}
            triggerPos={popover.triggerPos}
            inputValue={inputValue}
            textareaRef={textareaRef}
            setSelectedIndex={popover.setSelectedIndex}
            setPopoverFilter={popover.setPopoverFilter}
            setInputValue={setInputValue}
            onInsertItem={popover.insertItem}
            onClosePopover={popover.closePopover}
            fileHasMore={popover.fileHasMore}
            fileLoadingMore={popover.fileLoadingMore}
            onLoadMoreFiles={popover.loadMoreFileItems}
            t={t}
          />

          <PromptInput
            onSubmit={handleSubmit}
            accept=""
            multiple
            className={cn(
              "[&_[data-slot=input-group]]:rounded-[12px]",
              "[&_[data-slot=input-group]]:border-white/14",
              "[&_[data-slot=input-group]]:bg-white/[0.02]",
              "[&_[data-slot=input-group]]:shadow-none",
              "[&_[data-slot=input-group]]:hover:border-white/22",
              "[&_[data-slot=input-group]]:hover:bg-white/[0.03]",
              "[&_[data-slot=input-group]:has([data-slot=input-group-control]:focus-visible)]:border-primary/45",
              "[&_[data-slot=input-group]:has([data-slot=input-group-control]:focus-visible)]:shadow-[0_0_0_2px_rgba(88,148,255,0.2)]",
              "[&_[data-slot=input-group-control]]:placeholder:text-muted-foreground/86",
              "[&_[data-slot=input-group-addon]]:text-foreground/78",
              "[&_[data-slot=input-group]_[data-slot=button][data-variant=ghost]]:text-foreground/74",
              "[&_[data-slot=input-group]_[data-slot=button][data-variant=ghost]]:hover:bg-foreground/[0.07]",
              "[&_[data-slot=input-group]_[data-slot=button][data-variant=ghost]]:hover:text-foreground/96",
              "[&_[data-slot=input-group]_[data-slot=button][data-variant=default]]:bg-primary/92",
              "[&_[data-slot=input-group]_[data-slot=button][data-variant=default]]:hover:bg-primary",
              "[&_[data-slot=input-group]_[data-slot=button][data-variant=default]]:hover:translate-y-0",
              "[&_[data-slot=input-group]_[data-slot=button][data-variant=default]]:hover:brightness-100",
              "[&_[data-slot=input-group]_[data-slot=button][data-variant=default]]:hover:shadow-[0_2px_8px_var(--shadow-primary)]"
            )}
          >
            <FileTreeAttachmentBridge />

            {badge && <CommandBadgePill badge={badge} onRemove={removeBadge} />}

            <FileAttachmentsCapsules />

            <PromptInputTextarea
              ref={textareaRef}
              placeholder={
                badge
                  ? t('messageInput.placeholderBadge')
                  : assistantRuntime === 'codex'
                    ? t('messageInput.placeholderCodex')
                    : assistantRuntime === 'pi'
                      ? t('messageInput.placeholderPi')
                      : t('messageInput.placeholderClaude')
              }
              value={inputValue}
              onChange={(e) => {
                void popover.handleInputChange(e.currentTarget.value);
              }}
              onKeyDown={handleKeyDown}
              disabled={disabled && !isStreaming}
              className="min-h-10"
            />

            <PromptInputFooter>
              <PromptInputTools>
                <AttachFileButton />

                <MessageModeToggle mode={mode} onModeChange={onModeChange} t={t} />

                <ModelSelector
                  assistantRuntime={assistantRuntime}
                  isClaudeRuntime={isClaudeRuntime}
                  modelName={modelName}
                  currentModelValue={currentModelValue}
                  currentProviderIdValue={currentProviderIdValue}
                  currentModelLabel={currentModelOption.label}
                  providerGroups={providerGroups}
                  piModels={piModelsQuery.data?.models || []}
                  piModelsError={piModelsQuery.data?.error}
                  onModelChange={onModelChange}
                  onProviderModelChange={onProviderModelChange}
                />

                {assistantRuntime === 'codex' && (
                  <CodexEffortSelector
                    modelName={modelName}
                    onModelChange={onModelChange}
                  />
                )}

                {assistantRuntime === 'pi' && selectedPiModel?.reasoning && (
                  <PiThinkingLevelSelector
                    modelName={modelName}
                    fallbackModel={currentModelValue}
                    onModelChange={onModelChange}
                  />
                )}

                {typeof window !== 'undefined' && window.electronAPI?.terminal && onToggleTerminal && (
                  <PromptInputButton
                    onClick={onToggleTerminal}
                    aria-label={terminalOpen ? t('terminalPanel.hideTerminal') : t('terminalPanel.showTerminal')}
                  >
                    <HugeiconsIcon icon={CommandLineIcon} className={cn('h-4 w-4', terminalOpen && 'text-accent-foreground')} />
                  </PromptInputButton>
                )}
              </PromptInputTools>

              <FileAwareSubmitButton
                status={chatStatus}
                onStop={onStop}
                disabled={disabled}
                inputValue={inputValue}
                hasBadge={!!badge}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
