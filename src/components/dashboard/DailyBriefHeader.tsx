'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { useTodayCommits } from './useTodayCommits';

interface WeatherResponse {
  location: string | null;
  temperatureC: number | null;
  description: string | null;
}

async function fetchWeather(): Promise<WeatherResponse> {
  const res = await fetch('/api/dashboard/weather');
  if (!res.ok) throw new Error('Failed to fetch weather');
  return res.json();
}

export function DailyBriefHeader() {
  const { locale } = useTranslation();
  const [now, setNow] = useState<Date | null>(null);
  const { commitsToday, repoCount } = useTodayCommits();

  const { data: weather } = useQuery({
    queryKey: ['overview-weather'],
    queryFn: fetchWeather,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const dateText = useMemo(() => {
    if (!now) return '...';
    return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(now);
  }, [locale, now]);

  const weatherText = useMemo(() => {
    if (weather?.temperatureC == null && !weather?.description) {
      return '';
    }
    const location = weather?.location || '';
    const temp = weather?.temperatureC == null ? '' : `${weather.temperatureC}°C`;
    const desc = weather?.description ? `${weather.description}` : '';
    return [location, temp, desc].filter(Boolean).join(' · ');
  }, [weather]);

  return (
    <div className="flex flex-col gap-4">
       <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold tracking-[0.2em] uppercase text-sidebar-foreground/40">
          <span>{dateText}</span>
          {weatherText && (
            <>
              <span className="hidden sm:inline-block">|</span>
              <span>{weatherText}</span>
            </>
          )}
       </div>
       <h1 className="text-3xl sm:text-4xl lg:text-5xl font-light tracking-tight text-sidebar-foreground/90 leading-[1.2] sm:leading-[1.15]">
         {repoCount > 0 ? (locale === 'zh' ? `正在跟踪 ${repoCount} 个工作区。` : `Tracking ${repoCount} workspaces.`) : (locale === 'zh' ? '尚未配置工作区。' : 'No workspaces set up yet.')} 
         <br className="hidden sm:block" />
         {' '}
         {commitsToday > 0 ? (locale === 'zh' ? `今日已进行 ${commitsToday} 次提交。` : `${commitsToday} commits made today.`) : (locale === 'zh' ? '今日尚未提交。' : 'Fresh slate today.')}
       </h1>
    </div>
  );
}
