'use client';

import { useContext } from 'react';
import { I18nContext } from '@/components/layout/I18nProvider';

export function useTranslation() {
  return useContext(I18nContext);
}
