"use client";

import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useUpdate } from "@/hooks/useUpdate";
import { useTranslation } from "@/hooks/useTranslation";
import { openExternalLink } from "@/lib/external-links";

export function UpdateDialog() {
  const { updateInfo, showDialog, dismissUpdate, downloadUpdate, quitAndInstall } = useUpdate();
  const { t } = useTranslation();

  if (!updateInfo?.updateAvailable) return null;

  const { isNativeUpdate, readyToInstall, downloadProgress } = updateInfo;
  const isDownloading = isNativeUpdate && !readyToInstall && downloadProgress != null;

  return (
    <Dialog open={showDialog} onOpenChange={(open) => {
      if (!open) dismissUpdate();
    }}>
      <DialogContent className="border-border-default bg-bg-secondary text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('update.newVersionAvailable')}</DialogTitle>
          <DialogDescription className="text-foreground/86">
            {updateInfo.releaseName}
            {updateInfo.publishedAt && (
              <span className="ml-2 text-xs text-foreground/72">
                {new Date(updateInfo.publishedAt).toLocaleDateString()}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {updateInfo.releaseNotes && (
          <div className="max-h-60 overflow-auto rounded-lg border border-border-subtle bg-bg-tertiary p-3 text-sm text-foreground">
            <ReactMarkdown
              components={{
                h1: ({ children }) => <h3 className="mb-1 text-sm font-semibold text-foreground">{children}</h3>,
                h2: ({ children }) => <h3 className="mb-1 text-sm font-semibold text-foreground">{children}</h3>,
                h3: ({ children }) => <h4 className="mb-1 text-sm font-medium text-foreground">{children}</h4>,
                p: ({ children }) => <p className="mb-2 text-sm leading-relaxed text-foreground/92">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 list-disc pl-4 text-sm text-foreground/90">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 text-sm text-foreground/90">{children}</ol>,
                li: ({ children }) => <li className="mb-0.5 text-foreground/90">{children}</li>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-200 underline underline-offset-2 hover:text-blue-100">
                    {children}
                  </a>
                ),
                code: ({ children }) => (
                  <code className="rounded-md border border-border-subtle bg-bg-primary px-1 py-0.5 text-xs text-foreground">{children}</code>
                ),
              }}
            >
              {updateInfo.releaseNotes}
            </ReactMarkdown>
          </div>
        )}

        <p className="text-xs text-foreground/78">
          Current: v{updateInfo.currentVersion} &rarr; Latest: v{updateInfo.latestVersion}
        </p>

        {/* Download progress bar */}
        {isDownloading && (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(downloadProgress!, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('update.downloading')} {Math.round(downloadProgress!)}%
            </p>
          </div>
        )}

        {updateInfo.lastError && (
          <p className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
            {updateInfo.lastError}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={dismissUpdate}>
            {t('update.later')}
          </Button>
          {!isNativeUpdate ? (
            <Button
              onClick={() => {
                void openExternalLink(updateInfo.releaseUrl);
              }}
            >
              {t('settings.viewRelease')}
            </Button>
          ) : readyToInstall ? (
            <Button onClick={quitAndInstall}>
              {t('update.restartToUpdate')}
            </Button>
          ) : isDownloading ? (
            <Button disabled>
              {t('update.downloading')}...
            </Button>
          ) : (
            <Button onClick={downloadUpdate}>
              {t('update.installUpdate')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
