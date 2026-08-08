"use client";

import { Button } from "@/components/ui/button";
import { useUpdate } from "@/hooks/useUpdate";
import { useTranslation } from "@/hooks/useTranslation";

export function UpdateBanner() {
  const { updateInfo, quitAndInstall } = useUpdate();
  const { t } = useTranslation();

  if (!updateInfo?.isNativeUpdate || !updateInfo.readyToInstall) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-blue-500/20 bg-blue-500/10 px-4 py-1.5 text-sm">
      <span>{t('update.readyToInstall', { version: updateInfo.latestVersion })}</span>
      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={quitAndInstall}>
        {t('update.restartNow')}
      </Button>
    </div>
  );
}
