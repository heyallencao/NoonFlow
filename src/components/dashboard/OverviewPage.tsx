'use client';

import { NewOverviewHeader } from './NewOverviewHeader';
import { NewOverviewMetrics } from './NewOverviewMetrics';
import { ActivityChart } from './ActivityChart';
import { WhenYouWorkChart } from './WhenYouWorkChart';
import { CostByModelCard } from './CostByModelCard';
import { NewRecentSessionsCard } from './NewRecentSessionsCard';
import { AlertsSection } from './AlertsSection';
import { RecommendationsSection } from './RecommendationsSection';
import { SmallCardsSection } from './SmallCardsSection';
import { OverviewFooter } from './OverviewFooter';

export default function OverviewPage() {
  return (
    <div className="flex h-full min-h-0 min-h-full flex-col overflow-y-auto px-4 pb-4 pt-1 sm:px-6 sm:pb-6 lg:px-8 lg:pb-8">
      <div className="mx-auto flex min-h-full w-full flex-col gap-3 sm:gap-4">
        <div className="space-y-3 sm:space-y-4">

          {/* Section 1: Header - Tight coupling with metrics below */}
          <div className="pt-2 -mb-1">
            <NewOverviewHeader />
          </div>

          {/* Section 2: 4-column metric cards */}
          <NewOverviewMetrics />

          {/* Section 3: Activity + When You Work charts */}
          <div className="grid grid-cols-1 gap-2.5 sm:gap-3 lg:grid-cols-2">
            <ActivityChart />
            <WhenYouWorkChart />
          </div>

          {/* Section 4: Cost by Model + Recent Sessions */}
          <div className="grid grid-cols-1 gap-2.5 sm:gap-3 lg:grid-cols-2">
            <CostByModelCard />
            <NewRecentSessionsCard />
          </div>

          {/* Section 5: Alerts */}
          <AlertsSection />

          {/* Section 6: Recommendations */}
          <RecommendationsSection />

          {/* Section 7: Skills / Hooks / Agents / Memory small cards */}
          <SmallCardsSection />
        </div>

        {/* Section 9: Footer */}
        <div className="mt-auto">
          <OverviewFooter />
        </div>
      </div>
    </div>
  );
}
