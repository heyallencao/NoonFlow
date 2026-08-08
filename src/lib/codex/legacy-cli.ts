export type CodexCliReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

interface BuildLegacyCodexArgsParams {
  cwd: string;
  prompt: string;
  permissionMode?: string;
  skipPermissions: boolean;
  resolvedModel?: string;
  resolvedReasoningEffort?: CodexCliReasoningEffort;
  imagePaths: string[];
  resumeSessionId?: string;
}

export function buildLegacyCodexArgs(params: BuildLegacyCodexArgsParams): string[] {
  const {
    cwd,
    prompt,
    permissionMode,
    skipPermissions,
    resolvedModel,
    resolvedReasoningEffort,
    imagePaths,
    resumeSessionId,
  } = params;

  const args = [
    'exec',
    '--color',
    'never',
    '--cd',
    cwd,
    '--json',
    '--skip-git-repo-check',
  ];

  if (permissionMode === 'plan') {
    args.push('--sandbox', 'read-only');
  } else if (skipPermissions) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('--full-auto');
  }

  if (resolvedModel) {
    args.push('--model', resolvedModel);
  }
  if (resolvedReasoningEffort) {
    args.push('--config', `model_reasoning_effort=${resolvedReasoningEffort}`);
  }

  if (resumeSessionId) {
    args.push('resume');
    for (const imagePath of imagePaths) {
      args.push('--image', imagePath);
    }
    args.push('--', resumeSessionId, prompt);
    return args;
  }

  for (const imagePath of imagePaths) {
    args.push('--image', imagePath);
  }
  args.push('--', prompt);

  return args;
}
