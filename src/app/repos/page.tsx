import { Metadata } from 'next';
import { ReposPage } from '@/components/insights/ReposPage';

export const metadata: Metadata = {
  title: 'Repositories - NoonFlow',
  description: 'Browse Git repositories in your workspace',
};

export default function Page() {
  return <ReposPage />;
}
