"use client";

import { useEffect, useState } from "react";
import { ExternalLinkIcon, CopyIcon, ArrowUpRightIcon, CheckIcon } from "lucide-react";
import type { LinkSafetyConfig, LinkSafetyModalProps } from "streamdown";

import { openExternalLink } from "@/lib/external-links";
import { publishOpenFilePreview } from "@/lib/events/app-event-bus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripFileAnchor(pathValue: string): string {
  return pathValue.replace(/#L\d+(?:C\d+)?$/i, '').replace(/#\d+$/i, '');
}

const WEB_TLD_HINTS = new Set([
  "com",
  "net",
  "org",
  "io",
  "ai",
  "dev",
  "app",
  "co",
  "cn",
  "edu",
  "gov",
  "info",
  "me",
  "tech",
  "site",
  "xyz",
  "top",
  "cloud",
  "shop",
  "biz",
  "us",
  "uk",
  "de",
  "jp",
  "fr",
  "ru",
  "br",
  "in",
  "ca",
  "au",
]);

function looksLikeBareDomain(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || /[\\/]/.test(trimmed)) {
    return false;
  }

  const withoutHash = trimmed.split("#", 1)[0] || trimmed;
  const withoutQuery = withoutHash.split("?", 1)[0] || withoutHash;
  const withoutPort = withoutQuery.split(":", 1)[0] || withoutQuery;
  const labels = withoutPort.split(".");
  if (labels.length < 2) {
    return false;
  }

  const tld = labels[labels.length - 1];
  if (!tld || !WEB_TLD_HINTS.has(tld)) {
    return false;
  }

  return labels.every((label) => /^[a-z0-9-]+$/.test(label) && !label.startsWith("-") && !label.endsWith("-"));
}

const UNIX_ROOT_DIR_HINTS = new Set([
  "applications",
  "bin",
  "dev",
  "etc",
  "home",
  "library",
  "media",
  "mnt",
  "opt",
  "private",
  "sbin",
  "srv",
  "system",
  "tmp",
  "users",
  "usr",
  "var",
  "volumes",
]);

function looksLikeUnixAbsolutePath(pathValue: string): boolean {
  if (!pathValue.startsWith("/") || pathValue.startsWith("//")) {
    return false;
  }

  const noTrailingSlash = pathValue.replace(/\/+$/, "");
  const segments = noTrailingSlash.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  const first = segments[0]?.toLowerCase();
  if (first && UNIX_ROOT_DIR_HINTS.has(first)) {
    return true;
  }

  // Strong local-path signals that are uncommon in app routes.
  return segments.some((segment) =>
    segment.startsWith(".")
    || segment.includes(".")
    || /[^a-z0-9_-]/i.test(segment),
  );
}

function looksLikeFilePath(pathValue: string): boolean {
  const trimmed = stripFileAnchor(pathValue.trim());
  const decoded = stripFileAnchor(decodeSafe(trimmed));
  if (!trimmed) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || /^[A-Za-z]:[\\/]/.test(decoded)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return false;
  if (trimmed.startsWith("//") || decoded.startsWith("//")) return false;
  if (looksLikeBareDomain(trimmed) || looksLikeBareDomain(decoded)) return false;

  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return true;
  }

  if (looksLikeUnixAbsolutePath(decoded) || looksLikeUnixAbsolutePath(trimmed)) {
    return true;
  }

  const normalizedLineSuffix = trimmed.replace(/:(\d+)(?::\d+)?$/, '');
  const hasLikelyTextExtension = /\.[a-z0-9_-]*[a-z][a-z0-9_-]*$/i.test(normalizedLineSuffix);
  if (!hasLikelyTextExtension) return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return /\/[^/]+\.[^/]+$/.test(trimmed) || /^[./]*[^/]+\.[^/]+$/.test(trimmed);
  }
  return /^[^:]+\/[^/]+\.[^/]+$/.test(trimmed) || /^[^/]+\.[^/]+$/.test(trimmed);
}

function getLocalFilePath(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("file://")) {
    try {
      const parsed = new URL(trimmed);
      return `${decodeSafe(parsed.pathname)}${parsed.hash || ""}`;
    } catch {
      return decodeSafe(trimmed.replace(/^file:\/\//, ""));
    }
  }

  if (looksLikeFilePath(trimmed)) {
    return decodeSafe(trimmed);
  }

  return null;
}

function StreamdownLinkSafetyDialog({
  url,
  isOpen,
  onClose,
  onConfirm,
}: LinkSafetyModalProps) {
  const localFilePath = getLocalFilePath(url);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !localFilePath) return;
    publishOpenFilePreview({ path: localFilePath });
    onClose();
  }, [isOpen, localFilePath, onClose]);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  if (localFilePath) {
    return null;
  }

  const handleOpen = async () => {
    try {
      const didOpen = await openExternalLink(url);
      if (!didOpen) {
        onConfirm();
      }
    } finally {
      onClose();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Ignore clipboard write errors and keep the dialog usable.
    }
  };

  // Extract hostname for display
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url.length > 40 ? url.slice(0, 40) + '...' : url;
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={isOpen}
    >
      <DialogContent
        className="sm:max-w-[420px] overflow-hidden border-border-subtle/80 bg-bg-secondary/92 p-0 backdrop-blur-md shadow-[0_14px_34px_rgba(6,10,24,0.2)]"
        showCloseButton={false}
      >
        {/* Header area */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
              <ExternalLinkIcon className="size-4 text-primary/90" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-[15px] font-semibold leading-6 text-foreground/95">
                Open external link?
              </DialogTitle>
              <DialogDescription className="text-xs leading-5 text-muted-foreground">
                You are about to navigate to an external website. Please verify the URL before continuing.
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* URL display area */}
        <div className="mx-5 mb-1 overflow-hidden rounded-xl border border-border-subtle bg-bg-primary/45">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3.5 py-2">
            <span className="inline-flex rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/90">
              {hostname}
            </span>
          </div>
          <div className="max-h-24 overflow-y-auto break-all px-3.5 py-2.5 font-mono text-xs leading-5 text-muted-foreground selection:bg-primary/25">
            {url}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3.5">
          <button
            onClick={handleCopy}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-primary/45 px-3 py-2 text-xs font-medium text-foreground/82 transition-all duration-200 hover:bg-bg-tertiary"
          >
            {copied ? <CheckIcon className="size-3.5 text-green-400" /> : <CopyIcon className="size-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border-default bg-bg-primary/45 px-4 text-xs font-medium text-foreground/82 transition-all duration-200 hover:bg-bg-tertiary"
            >
              Cancel
            </button>
            <button
              onClick={handleOpen}
              type="button"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary/92 px-4 text-xs font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/84"
            >
              Open link
              <ArrowUpRightIcon className="size-3.5" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const STREAMDOWN_LINK_SAFETY: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => <StreamdownLinkSafetyDialog {...props} />,
};
