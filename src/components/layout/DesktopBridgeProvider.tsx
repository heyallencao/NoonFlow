"use client";

import { useEffect } from "react";
import { clearTerminalSessionCache } from "@/lib/terminal-buffer-cache";
import { subscribeSessionTabClosed } from '@/lib/events/app-event-bus';
import { subscribeSessionRefresh } from '@/lib/events/session-refresh-hub';
import { getExternalNavigationUrl, openExternalLink } from "@/lib/external-links";

const DESKTOP_BRIDGE_READY_EVENT = "noonflow:desktop-bridge-ready";

export function DesktopBridgeProvider() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.electronAPI) {
      window.dispatchEvent(new Event(DESKTOP_BRIDGE_READY_EVENT));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.electronAPI?.shell?.openExternal) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href) return;

      const externalUrl = getExternalNavigationUrl(href, window.location.origin);
      if (!externalUrl) return;

      event.preventDefault();
      void openExternalLink(externalUrl);
    };

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const unsubscribeSessionTabClosed = subscribeSessionTabClosed((detail) => {
      if (detail?.sessionType !== "terminal") return;
      if (!detail.sessionId) return;
      clearTerminalSessionCache(detail.sessionId);
    });

    const unsubscribeSessionDeleted = subscribeSessionRefresh((detail) => {
      if (detail.type !== 'deleted') return;
      const sessionIds = new Set<string>();
      if (typeof detail.sessionId === "string" && detail.sessionId) {
        sessionIds.add(detail.sessionId);
      }
      if (Array.isArray(detail.sessionIds)) {
        for (const id of detail.sessionIds) {
          if (typeof id === "string" && id) {
            sessionIds.add(id);
          }
        }
      }
      for (const sessionId of sessionIds) {
        clearTerminalSessionCache(sessionId);
      }
    });

    return () => {
      unsubscribeSessionTabClosed();
      unsubscribeSessionDeleted();
    };
  }, []);

  return null;
}
