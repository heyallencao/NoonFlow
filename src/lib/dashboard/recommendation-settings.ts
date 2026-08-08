export type OverviewRecommendationTemplate = 'focused' | 'balanced' | 'strict' | 'custom';

export interface OverviewRecommendationConfig {
  template: OverviewRecommendationTemplate;
  rules: {
    largeInstructionFile: {
      enabled: boolean;
      lineThreshold: number;
    };
    monthlyCost: {
      enabled: boolean;
      amountThresholdUsd: number;
    };
    missingProjectGuide: {
      enabled: boolean;
      minMissingRepos: number;
    };
    dirtyRepo: {
      enabled: boolean;
      dirtyFilesThreshold: number;
    };
    staleBranches: {
      enabled: boolean;
      staleBranchThreshold: number;
    };
  };
}

export const OVERVIEW_RECOMMENDATION_TEMPLATES: Record<
  Exclude<OverviewRecommendationTemplate, 'custom'>,
  OverviewRecommendationConfig
> = {
  focused: {
    template: 'focused',
    rules: {
      largeInstructionFile: { enabled: true, lineThreshold: 360 },
      monthlyCost: { enabled: false, amountThresholdUsd: 60 },
      missingProjectGuide: { enabled: true, minMissingRepos: 3 },
      dirtyRepo: { enabled: true, dirtyFilesThreshold: 24 },
      staleBranches: { enabled: false, staleBranchThreshold: 6 },
    },
  },
  balanced: {
    template: 'balanced',
    rules: {
      largeInstructionFile: { enabled: true, lineThreshold: 240 },
      monthlyCost: { enabled: false, amountThresholdUsd: 20 },
      missingProjectGuide: { enabled: true, minMissingRepos: 1 },
      dirtyRepo: { enabled: true, dirtyFilesThreshold: 12 },
      staleBranches: { enabled: true, staleBranchThreshold: 3 },
    },
  },
  strict: {
    template: 'strict',
    rules: {
      largeInstructionFile: { enabled: true, lineThreshold: 120 },
      monthlyCost: { enabled: false, amountThresholdUsd: 10 },
      missingProjectGuide: { enabled: true, minMissingRepos: 1 },
      dirtyRepo: { enabled: true, dirtyFilesThreshold: 6 },
      staleBranches: { enabled: true, staleBranchThreshold: 1 },
    },
  },
};

function cloneConfig(config: OverviewRecommendationConfig): OverviewRecommendationConfig {
  return JSON.parse(JSON.stringify(config)) as OverviewRecommendationConfig;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const next = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(Math.round(next), min), max);
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  const next = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(next, min), max);
}

function detectTemplate(rules: OverviewRecommendationConfig['rules']): OverviewRecommendationTemplate {
  for (const [templateKey, templateConfig] of Object.entries(OVERVIEW_RECOMMENDATION_TEMPLATES)) {
    if (JSON.stringify(templateConfig.rules) === JSON.stringify(rules)) {
      return templateKey as Exclude<OverviewRecommendationTemplate, 'custom'>;
    }
  }
  return 'custom';
}

export function createOverviewRecommendationConfig(
  template: Exclude<OverviewRecommendationTemplate, 'custom'> = 'balanced',
): OverviewRecommendationConfig {
  return cloneConfig(OVERVIEW_RECOMMENDATION_TEMPLATES[template]);
}

export function normalizeOverviewRecommendationConfig(
  input: Partial<OverviewRecommendationConfig> | null | undefined,
): OverviewRecommendationConfig {
  const base = createOverviewRecommendationConfig('balanced');
  const rules = input?.rules;

  const normalized: OverviewRecommendationConfig = {
    template: 'custom',
    rules: {
      largeInstructionFile: {
        enabled: rules?.largeInstructionFile?.enabled ?? base.rules.largeInstructionFile.enabled,
        lineThreshold: clampInteger(
          rules?.largeInstructionFile?.lineThreshold,
          base.rules.largeInstructionFile.lineThreshold,
          20,
          5000,
        ),
      },
      monthlyCost: {
        enabled: rules?.monthlyCost?.enabled ?? base.rules.monthlyCost.enabled,
        amountThresholdUsd: clampFloat(
          rules?.monthlyCost?.amountThresholdUsd,
          base.rules.monthlyCost.amountThresholdUsd,
          0,
          100000,
        ),
      },
      missingProjectGuide: {
        enabled: rules?.missingProjectGuide?.enabled ?? base.rules.missingProjectGuide.enabled,
        minMissingRepos: clampInteger(
          rules?.missingProjectGuide?.minMissingRepos,
          base.rules.missingProjectGuide.minMissingRepos,
          1,
          500,
        ),
      },
      dirtyRepo: {
        enabled: rules?.dirtyRepo?.enabled ?? base.rules.dirtyRepo.enabled,
        dirtyFilesThreshold: clampInteger(
          rules?.dirtyRepo?.dirtyFilesThreshold,
          base.rules.dirtyRepo.dirtyFilesThreshold,
          1,
          5000,
        ),
      },
      staleBranches: {
        enabled: rules?.staleBranches?.enabled ?? base.rules.staleBranches.enabled,
        staleBranchThreshold: clampInteger(
          rules?.staleBranches?.staleBranchThreshold,
          base.rules.staleBranches.staleBranchThreshold,
          1,
          500,
        ),
      },
    },
  };

  const requestedTemplate = input?.template;
  if (requestedTemplate && requestedTemplate !== 'custom' && OVERVIEW_RECOMMENDATION_TEMPLATES[requestedTemplate]) {
    return cloneConfig(OVERVIEW_RECOMMENDATION_TEMPLATES[requestedTemplate]);
  }

  normalized.template = detectTemplate(normalized.rules);
  return normalized;
}

export function parseOverviewRecommendationConfig(raw: string | null | undefined): OverviewRecommendationConfig {
  if (!raw) {
    return createOverviewRecommendationConfig('balanced');
  }

  try {
    return normalizeOverviewRecommendationConfig(JSON.parse(raw) as Partial<OverviewRecommendationConfig>);
  } catch {
    return createOverviewRecommendationConfig('balanced');
  }
}

export function serializeOverviewRecommendationConfig(config: OverviewRecommendationConfig): string {
  return JSON.stringify(normalizeOverviewRecommendationConfig(config));
}
