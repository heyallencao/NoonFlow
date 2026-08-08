"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { ZapIcon, Cancel01Icon, ArrowDown01Icon, Search01Icon, GlobeIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import type { MarketplaceSkill } from "@/types";
import { InstallProgressDialog } from "./InstallProgressDialog";
import { useTranslation } from "@/hooks/useTranslation";

interface BrowseSkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
}

export function BrowseSkillsDialog({ open, onOpenChange, onInstalled }: BrowseSkillsDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MarketplaceSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const [installingSkill, setInstallingSkill] = useState<MarketplaceSkill | null>(null);

  const mergeSkills = useCallback((current: MarketplaceSkill[], incoming: MarketplaceSkill[]) => {
    const next = [...current];
    for (const skill of incoming) {
      if (!next.some((item) => item.source === skill.source || item.id === skill.id)) {
        next.push(skill);
      }
    }
    return next;
  }, []);

  const doSearch = useCallback(async (
    query: string,
    options?: { append?: boolean; cursor?: string | null },
  ) => {
    const append = options?.append === true;
    const cursor = options?.cursor || null;
    const requestSeq = ++requestSeqRef.current;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "20");
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/skills/marketplace/search?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (requestSeq !== requestSeqRef.current) {
        return;
      }
      const incoming = Array.isArray(data.skills) ? data.skills as MarketplaceSkill[] : [];
      const parsedNextCursor = typeof data.nextCursor === "string" && data.nextCursor.length > 0
        ? data.nextCursor
        : null;

      setResults((prev) => (append ? mergeSkills(prev, incoming) : incoming));
      setNextCursor(parsedNextCursor);
    } catch (err) {
      if (requestSeq === requestSeqRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [mergeSkills]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, doSearch, open]);

  const handleListScroll = useCallback(() => {
    const container = listContainerRef.current;
    if (!container || loading || loadingMore || !nextCursor) {
      return;
    }

    const threshold = 120;
    const reachedBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
    if (!reachedBottom) {
      return;
    }

    void doSearch(search, { append: true, cursor: nextCursor });
  }, [doSearch, loading, loadingMore, nextCursor, search]);

  const handleInstall = (skill: MarketplaceSkill) => {
    setInstallingSkill(skill);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 bg-bg-secondary border-border-default shadow-2xl overflow-hidden rounded-2xl">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-info/10 text-info">
              <HugeiconsIcon icon={GlobeIcon} className="h-4 w-4" />
            </div>
            {t("skills.marketplace")}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4 border-b border-border-subtle bg-bg-secondary">
          <div className="relative flex items-center bg-bg-primary border border-border-subtle rounded-xl px-3 py-2.5 focus-within:ring-1 focus-within:ring-info/40 transition-all">
            <HugeiconsIcon icon={Search01Icon} className="h-4 w-4 text-muted-foreground/50 mr-2.5 shrink-0" />
            <input
              autoFocus
              className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground/30 text-foreground"
              placeholder={t("skills.marketplaceSearch")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch("")} className="ml-2 text-muted-foreground/40 hover:text-foreground shrink-0 transition-colors">
                <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div
          ref={listContainerRef}
          onScroll={handleListScroll}
          className="flex-1 overflow-y-auto max-h-[400px] bg-bg-primary custom-scrollbar"
        >
          {loading && results.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground/50 font-medium">
              <HugeiconsIcon icon={Search01Icon} className="mx-auto mb-3 h-8 w-8 animate-pulse opacity-20" />
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="p-12 text-center text-sm text-destructive font-medium">
              {error}
            </div>
          ) : results.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground/50 font-medium">
              <HugeiconsIcon icon={ZapIcon} className="mx-auto mb-3 h-8 w-8 opacity-10" />
              {t("skills.searchNoResults")}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border-subtle/30">
              {results.map((skill) => (
                <div key={skill.id || `${skill.source}:${skill.skillId || skill.name}`} className="flex flex-col p-4 border-b border-border-subtle/30 hover:bg-bg-hover transition-all group">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info transition-colors">
                        <HugeiconsIcon icon={ZapIcon} className="h-4 w-4" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[14px] font-bold text-foreground truncate group-hover:text-info transition-colors">{skill.name}</span>
                        <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5 uppercase tracking-tight font-medium">
                          {skill.source || "---"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleInstall(skill)}
                      disabled={installingSkill?.id === skill.id}
                      className="shrink-0 h-8 text-xs font-bold px-4 bg-muted/10 hover:bg-info hover:text-white rounded-lg transition-all"
                    >
                      <HugeiconsIcon icon={ArrowDown01Icon} className="h-3.5 w-3.5 mr-1.5" />
                      {installingSkill?.id === skill.id ? t("skills.installing") : t("skills.install")}
                    </Button>
                  </div>
                </div>
              ))}
              {loadingMore && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {t("common.loading")}
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between p-3 border-t border-border-subtle bg-bg-secondary text-[11px] font-medium text-muted-foreground/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 opacity-60">↑↓ navigate</span>
            <span className="flex items-center gap-1 opacity-60">↵ install</span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => onOpenChange(false)} 
            className="h-7 px-3 rounded-lg hover:bg-bg-hover text-muted-foreground hover:text-foreground font-bold"
          >
            {t("common.close")}
          </Button>
        </div>
      </DialogContent>
      {installingSkill && (
        <InstallProgressDialog
          open={!!installingSkill}
          onOpenChange={(open) => !open && setInstallingSkill(null)}
          action="install"
          source={installingSkill.source}
          skillName={installingSkill.name}
          onComplete={() => {
            onInstalled();
            setInstallingSkill(null);
          }}
        />
      )}
    </Dialog>
  );
}
