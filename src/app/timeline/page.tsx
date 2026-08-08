import { Metadata } from 'next';
import TimelinePage from '@/components/insights/TimelinePage';

export const metadata: Metadata = {
  title: 'History - NoonFlow',
  description: 'View repository history across your workspace',
};

export default function Page() {
  return <TimelinePage />;
}
