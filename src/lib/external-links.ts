"use client";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function normalizeExternalUrl(rawUrl: string): string | null {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    return null;
  }

  try {
    const parsed = new URL(trimmedUrl);
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    if (trimmedUrl.startsWith("//")) {
      try {
        const parsed = new URL(`https:${trimmedUrl}`);
        return parsed.toString();
      } catch {
        return null;
      }
    }

    if (/^[\w.-]+\.[a-z]{2,}([/?#:]|$)/i.test(trimmedUrl)) {
      try {
        const parsed = new URL(`https://${trimmedUrl}`);
        return parsed.toString();
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function getExternalNavigationUrl(url: string, currentOrigin: string): string | null {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) {
    return null;
  }

  const parsed = new URL(normalizedUrl);
  if (parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
    return normalizedUrl;
  }

  return parsed.origin === currentOrigin ? null : normalizedUrl;
}

export async function openExternalLink(url: string): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) {
    return false;
  }

  if (window.electronAPI?.shell?.openExternal) {
    try {
      await window.electronAPI.shell.openExternal(normalizedUrl);
      return true;
    } catch {
      // Fallback to browser behavior if desktop bridge call fails.
    }
  }

  window.open(normalizedUrl, "_blank", "noopener,noreferrer");
  return true;
}
