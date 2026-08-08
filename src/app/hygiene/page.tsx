import { Metadata } from 'next';
import HygienePage from '@/components/insights/HygienePage';

export const metadata: Metadata = {
  title: 'Insights - NoonFlow',
  description: 'Repository insights and health signals',
};

export default function Page() {
  return <HygienePage />;
}
