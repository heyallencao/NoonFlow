import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverviewRecommendations,
  type OverviewRecommendationSignals,
} from '../../lib/dashboard/recommendations';
import {
  createOverviewRecommendationConfig,
  normalizeOverviewRecommendationConfig,
  OVERVIEW_RECOMMENDATION_TEMPLATES,
  parseOverviewRecommendationConfig,
} from '../../lib/dashboard/recommendation-settings';

describe('buildOverviewRecommendations', () => {
  it('builds dynamic recommendations from live signals and sorts them by urgency', () => {
    const config = createOverviewRecommendationConfig('balanced');
    config.rules.monthlyCost.enabled = true;
    config.rules.dirtyRepo.dirtyFilesThreshold = 24;
    const signals: OverviewRecommendationSignals = {
      monthCost: 34.8,
      repoInsights: [
        {
          repoName: 'monolith',
          repoRoot: '/tmp/monolith',
          dirtyFilesCount: 19,
          untrackedFilesCount: 2,
          staleBranchesCount: 5,
          hasProjectGuide: true,
          guideFiles: [
            {
              fileName: 'CLAUDE.md',
              lineCount: config.rules.largeInstructionFile.lineThreshold + 80,
              sizeBytes: 4096,
            },
          ],
        },
        {
          repoName: 'playground',
          repoRoot: '/tmp/playground',
          dirtyFilesCount: 0,
          untrackedFilesCount: 0,
          staleBranchesCount: 0,
          hasProjectGuide: false,
          guideFiles: [],
        },
      ],
    };

    const recommendations = buildOverviewRecommendations(signals, config);

    assert.equal(recommendations.length, 3);
    assert.deepEqual(
      recommendations.map((entry) => entry.id),
      ['large_instruction_file', 'high_monthly_cost', 'stale_branches'],
    );
    assert.equal(recommendations[0]?.details.repoName, 'monolith');
    assert.equal(recommendations[0]?.primaryAction.type, 'open_path');
    assert.equal(recommendations[1]?.badgeKind, 'cost');
    assert.equal(recommendations[1]?.primaryAction.type, 'route');
    assert.equal(recommendations[2]?.details.staleBranchesCount, 5);
  });

  it('omits recommendations when thresholds are not hit', () => {
    const config = createOverviewRecommendationConfig('balanced');
    const signals: OverviewRecommendationSignals = {
      monthCost: config.rules.monthlyCost.amountThresholdUsd - 0.01,
      repoInsights: [
        {
          repoName: 'clean-repo',
          repoRoot: '/tmp/clean-repo',
          dirtyFilesCount: config.rules.dirtyRepo.dirtyFilesThreshold - 1,
          untrackedFilesCount: 0,
          staleBranchesCount: config.rules.staleBranches.staleBranchThreshold - 1,
          hasProjectGuide: true,
          guideFiles: [
            {
              fileName: 'AGENTS.md',
              lineCount: config.rules.largeInstructionFile.lineThreshold - 1,
              sizeBytes: 1024,
            },
          ],
        },
      ],
    };

    const recommendations = buildOverviewRecommendations(signals, config);

    assert.equal(recommendations.length, 0);
  });
});

describe('overview recommendation settings', () => {
  it('falls back to balanced template when config is invalid', () => {
    const config = parseOverviewRecommendationConfig('{invalid');
    assert.deepEqual(config, OVERVIEW_RECOMMENDATION_TEMPLATES.balanced);
  });

  it('marks manually adjusted rules as custom while preserving values', () => {
    const config = normalizeOverviewRecommendationConfig({
      template: 'custom',
      rules: {
        ...OVERVIEW_RECOMMENDATION_TEMPLATES.balanced.rules,
        dirtyRepo: {
          enabled: true,
          dirtyFilesThreshold: 22,
        },
      },
    });

    assert.equal(config.template, 'custom');
    assert.equal(config.rules.dirtyRepo.dirtyFilesThreshold, 22);
    assert.equal(
      config.rules.monthlyCost.amountThresholdUsd,
      OVERVIEW_RECOMMENDATION_TEMPLATES.balanced.rules.monthlyCost.amountThresholdUsd,
    );
  });
});
