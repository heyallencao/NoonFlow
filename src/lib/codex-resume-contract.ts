export type CodexResumeInvalidationReason =
  | 'mode_changed'
  | 'system_prompt_append'
  | 'session_model_missing'
  | 'model_changed'
  | 'cwd_missing';

export type CodexSessionPatchInvalidationReason =
  | 'working_directory_updated'
  | 'mode_updated'
  | 'model_updated'
  | 'provider_updated'
  | 'system_prompt_updated'
  | 'messages_cleared';

interface EvaluateCodexResumeInvalidationParams {
  resumeSessionId?: string | null;
  effectiveMode: string;
  sessionMode?: string | null;
  systemPromptAppend?: string | null;
  effectiveModel?: string | null;
  sessionModel?: string | null;
  sdkCwd?: string | null;
  workingDirectory?: string | null;
  pathExists?: (targetPath: string) => boolean;
}

export function evaluateCodexResumeInvalidation(
  params: EvaluateCodexResumeInvalidationParams,
): CodexResumeInvalidationReason[] {
  const {
    resumeSessionId,
    effectiveMode,
    sessionMode,
    systemPromptAppend,
    effectiveModel,
    sessionModel,
    sdkCwd,
    workingDirectory,
    pathExists = () => true,
  } = params;

  const normalizedResumeSessionId = resumeSessionId?.trim();
  if (!normalizedResumeSessionId) {
    return [];
  }

  const reasons: CodexResumeInvalidationReason[] = [];
  const normalizedSessionMode = (sessionMode || 'code').trim() || 'code';
  if (effectiveMode !== normalizedSessionMode) {
    reasons.push('mode_changed');
  }

  if ((systemPromptAppend || '').trim().length > 0) {
    reasons.push('system_prompt_append');
  }

  const normalizedEffectiveModel = (effectiveModel || '').trim();
  const normalizedSessionModel = (sessionModel || '').trim();
  if (normalizedEffectiveModel.length > 0) {
    if (normalizedSessionModel.length === 0) {
      reasons.push('session_model_missing');
    } else if (normalizedEffectiveModel !== normalizedSessionModel) {
      reasons.push('model_changed');
    }
  }

  const cwdCandidate = (sdkCwd || workingDirectory || '').trim();
  if (cwdCandidate && !pathExists(cwdCandidate)) {
    reasons.push('cwd_missing');
  }

  return reasons;
}

interface EvaluateCodexResumePatchInvalidationParams {
  assistantRuntime?: string | null;
  resumeSessionId?: string | null;
  currentWorkingDirectory?: string | null;
  currentMode?: string | null;
  currentModel?: string | null;
  currentProviderId?: string | null;
  currentSystemPrompt?: string | null;
  patch: {
    working_directory?: string;
    mode?: string;
    model?: string;
    provider_id?: string;
    system_prompt?: string;
    clear_messages?: boolean;
  };
}

export function evaluateCodexResumePatchInvalidation(
  params: EvaluateCodexResumePatchInvalidationParams,
): CodexSessionPatchInvalidationReason[] {
  const {
    assistantRuntime,
    resumeSessionId,
    currentWorkingDirectory,
    currentMode,
    currentModel,
    currentProviderId,
    currentSystemPrompt,
    patch,
  } = params;

  if (assistantRuntime !== 'codex' || !(resumeSessionId || '').trim()) {
    return [];
  }

  const reasons: CodexSessionPatchInvalidationReason[] = [];

  if (
    patch.working_directory !== undefined
    && patch.working_directory !== currentWorkingDirectory
  ) {
    reasons.push('working_directory_updated');
  }

  if (patch.mode !== undefined && patch.mode !== currentMode) {
    reasons.push('mode_updated');
  }

  if (patch.model !== undefined && patch.model !== currentModel) {
    reasons.push('model_updated');
  }

  if (patch.provider_id !== undefined && patch.provider_id !== currentProviderId) {
    reasons.push('provider_updated');
  }

  if (patch.system_prompt !== undefined && patch.system_prompt !== currentSystemPrompt) {
    reasons.push('system_prompt_updated');
  }

  if (patch.clear_messages) {
    reasons.push('messages_cleared');
  }

  return reasons;
}
