"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CodeIcon,
  CpuIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { EnvironmentSection } from "./EnvironmentSection";
import { GeneralSettings } from "./GeneralSettings";
import { ModelProviderSection } from "./ModelProviderSection";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";

type Section = "general" | "environment" | "providers";

const DEFAULT_SECTION: Section = "general";

interface SidebarItem {
  id: Section;
  icon: typeof Settings02Icon;
  label: { zh: string; en: string };
}

const sidebarItems: SidebarItem[] = [
  {
    id: "general",
    icon: Settings02Icon,
    label: { zh: "通用", en: "General" },
  },
  {
    id: "environment",
    icon: CodeIcon,
    label: { zh: "环境", en: "Environment" },
  },
  {
    id: "providers",
    icon: CpuIcon,
    label: { zh: "服务商", en: "Providers" },
  },
];

function getSectionFromHash(): Section {
  if (typeof window === "undefined") return DEFAULT_SECTION;
  const hash = window.location.hash.replace("#", "");
  if (sidebarItems.some((item) => item.id === hash)) {
    return hash as Section;
  }
  return DEFAULT_SECTION;
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function SettingsLayout() {
  const router = useRouter();
  const hashSection = useSyncExternalStore(subscribeToHash, getSectionFromHash, () => DEFAULT_SECTION);
  const [overrideSection, setOverrideSection] = useState<Section | null>(null);
  const activeSection = overrideSection ?? hashSection;
  const { t, locale } = useTranslation();
  const isZh = locale === "zh";

  const activeItem = useMemo(
    () => sidebarItems.find((item) => item.id === activeSection) ?? sidebarItems[0],
    [activeSection],
  );

  const handleSectionChange = useCallback((section: Section) => {
    setOverrideSection(section);
    window.history.replaceState(null, "", `/settings#${section}`);
    queueMicrotask(() => setOverrideSection(null));
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const sectionTitle = useMemo(() => {
    return isZh ? activeItem.label.zh : activeItem.label.en;
  }, [activeItem, isZh]);

  const content = useMemo(() => {
    if (activeSection === "general") {
      return <GeneralSettings />;
    }
    if (activeSection === "environment") {
      return <EnvironmentSection />;
    }
    if (activeSection === "providers") {
      return <ModelProviderSection mode="providers" />;
    }
    return <ModelProviderSection mode="providers" />;
  }, [activeSection]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Top bar */}
      <header className="shrink-0 border-b border-border-subtle bg-background">
        <div className="flex items-center justify-between gap-3 px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="h-9 rounded-full px-3 text-foreground hover:bg-accent"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="h-4 w-4" />
            <span className="ml-1 text-sm">{isZh ? "返回" : "Back"}</span>
          </Button>
          <h1 className="text-sm font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            {t("settings.title")}
          </h1>
          <div className="w-[72px] shrink-0" />
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar - macOS Preferences style */}
        <aside className="w-[220px] shrink-0 border-r border-border-subtle bg-bg-secondary/30 flex flex-col">
          <nav className="flex flex-col gap-0.5 px-3 py-5">
            {sidebarItems.map((item) => {
              const active = item.id === activeSection;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSectionChange(item.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-bg-hover hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon icon={item.icon} className="h-4 w-4 shrink-0" />
                  <span className="text-[13px] font-medium">
                    {isZh ? item.label.zh : item.label.en}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-8 py-6">
            {/* Section title */}
            <div className="mb-8">
              <h2 className="text-[28px] font-semibold tracking-tight text-foreground">
                {sectionTitle}
              </h2>
            </div>

            <div key={activeSection}>
              {content}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
