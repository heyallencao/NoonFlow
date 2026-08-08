'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { useTranslation } from '@/hooks/useTranslation';

function hasDesktopTerminalApi() {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.terminal);
}

function subscribeToDesktopRuntime() {
  return () => {};
}

export default function TerminalWorkspaceEntryPage() {
  const { t } = useTranslation();
  const isDesktopRuntime = useSyncExternalStore(
    subscribeToDesktopRuntime,
    hasDesktopTerminalApi,
    () => false
  );

  if (!isDesktopRuntime) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-xl rounded-2xl border border-border-subtle bg-bg-secondary p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-sidebar-foreground">{t('nav.terminal')}</h1>
          <p className="mt-2 text-sm text-sidebar-foreground/72">{t('terminal.desktopOnly')}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/chat">{t('nav.chat')}</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard">{t('nav.dashboard')}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ChatEmptyState
      sessionType="terminal"
      sessionPathPrefix="/terminal"
    />
  );
}
