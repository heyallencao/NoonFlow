'use client';

import { useEffect, useState } from 'react';
import { useTodayCommits } from './useTodayCommits';
import { DevMoodCompanion, DevMoodStatusPanel, getMood } from './DevMoodCompanion';

export function NewOverviewHeader() {
  const [now, setNow] = useState(() => new Date());
  const { commitsToday } = useTodayCommits();

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const hour = now.getHours();
  const mood = getMood(0, commitsToday, 0, hour);

  return (
    <div className="flex items-center justify-between gap-4 pb-0 pt-1">
      <div className="flex items-center">
        <DevMoodCompanion
          commitsToday={commitsToday}
          workMinutes={0}
          sessionsToday={0}
        />
      </div>

      <DevMoodStatusPanel mood={mood} />
    </div>
  );
}
