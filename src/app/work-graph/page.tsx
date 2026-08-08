import { Metadata } from 'next';
import { Suspense } from 'react';
import WorkGraphPage from '@/components/insights/WorkGraphPage';

export const metadata: Metadata = {
  title: 'Activities - NoonFlow',
  description: 'View repository activity across your workspace',
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WorkGraphPage />
    </Suspense>
  );
}
