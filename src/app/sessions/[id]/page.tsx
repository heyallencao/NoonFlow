'use client';

import dynamic from 'next/dynamic';

const SessionTimeline = dynamic(
  () => import('@/components/sessions/SessionTimeline').then(mod => ({ default: mod.SessionTimeline })),
  { ssr: false }
);

export default function SessionDetailPage() {
  return <SessionTimeline />;
}
