"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Loading02Icon, Store01Icon } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";
import { MarketplaceSkillCard } from "./MarketplaceSkillCard";
import { MarketplaceSkillDetail } from "./MarketplaceSkillDetail";
import type { MarketplaceSkill } from "@/types";

interface MarketplaceBrowserProps {
  onInstalled: () => void;
}

export function MarketplaceBrowser({ onInstalled }: MarketplaceBrowserProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MarketplaceSkill[]>([]);
  const [selected, setSelected] = useState<MarketplaceSkill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const doSearch = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "20");
      const res = await fetch(`/api/skills/marketplace/search?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResults(data.skills || []);
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — fetch popular skills
  useEffect(() => {
    doSearch("");
  }, [doSearch]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, doSearch]);

  useEffect(() => {
    if (!selected) return;
    const nextSelected = results.find((skill) => skill.id === selected.id) || null;
    if (nextSelected && nextSelected !== selected) {
      setSelected(nextSelected);
    }
  }, [results, selected]);

  const handleInstallComplete = useCallback(() => {
    // Refresh results to update installed status
    doSearch(search);
    onInstalled();
  }, [search, doSearch, onInstalled]);

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Left: search + results */}
      <div className="w-64 shrink-0 flex flex-col border border-border rounded-lg overflow-hidden">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
            />
            <Input
              placeholder={t('skills.marketplaceSearch')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-1">
            {loading && results.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground px-3">
                <p className="text-xs text-center text-red-500">{t('skills.marketplaceError')}</p>
                <p className="text-[10px] text-center">{error}</p>
              </div>
            )}
            {!loading && !error && results.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <HugeiconsIcon icon={Store01Icon} className="h-8 w-8 opacity-40" />
                <p className="text-xs">{t('skills.searchNoResults')}</p>
              </div>
            )}
            {results.map((skill) => (
              <MarketplaceSkillCard
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onSelect={() => setSelected(skill)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 min-w-0 border border-border rounded-lg overflow-hidden">
        {selected ? (
          <MarketplaceSkillDetail
            key={selected.id}
            skill={selected}
            onInstallComplete={handleInstallComplete}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <HugeiconsIcon icon={Store01Icon} className="h-12 w-12 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">{t('skills.marketplaceHint')}</p>
              <p className="text-xs">{t('skills.marketplaceHintDesc')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
