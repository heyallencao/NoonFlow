"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Message02Icon,
  ZapIcon,
  Plug01Icon,
  CommandLineIcon,
  Settings02Icon,
  Moon02Icon,
  Sun02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";


interface NavRailProps {
  chatListOpen: boolean;
  onToggleChatList: () => void;
  hasUpdate?: boolean;
  readyToInstall?: boolean;
  skipPermissionsActive?: boolean;
}

const navItems = [
  { href: "/chat", label: "Chats", icon: Message02Icon },
  { href: "/skills", label: "Skills", icon: ZapIcon },
  { href: "/hooks", label: "Hooks", icon: Plug01Icon },
  { href: "/agents", label: "Agents", icon: CommandLineIcon },
  { href: "/settings", label: "Settings", icon: Settings02Icon },
] as const;

export function NavRail({ onToggleChatList, hasUpdate, readyToInstall, skipPermissionsActive }: NavRailProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const navLabelKeys: Record<string, TranslationKey> = {
    'Chats': 'nav.chats',
    'Skills': 'extensions.skills',
    'Hooks': 'extensions.hooks',
    'Agents': 'extensions.agents',
    'Settings': 'nav.settings',
  };
  const emptySubscribe = useCallback(() => () => {}, []);
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const isChatRoute = pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <aside className="flex w-16 shrink-0 flex-col items-center bg-sidebar border-r border-sidebar-border shadow-lg z-50 pb-4 pt-8">
      {/* Nav icons */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/chat"
              ? pathname === "/chat" || pathname.startsWith("/chat/")
              : pathname === item.href || pathname.startsWith(item.href + "/") || pathname.startsWith(item.href + "?");

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                {item.href === "/chat" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-10 w-10 transition-all duration-300 hover:scale-105 relative",
                      isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                    onClick={() => {
                      if (!isChatRoute) {
                        // Navigate to chat page first, then open chat list
                        router.push("/chat");
                        onToggleChatList();
                      } else {
                        onToggleChatList();
                      }
                    }}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                    )}
                    <HugeiconsIcon icon={item.icon} className="h-4 w-4" />
                    <span className="sr-only">{t(navLabelKeys[item.label] ?? item.label as TranslationKey)}</span>
                  </Button>
                ) : (
                  <div className="relative">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-10 w-10 transition-all duration-300 hover:scale-105 relative",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                    >
                      <Link href={item.href}>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full" />
                        )}
                        <HugeiconsIcon icon={item.icon} className="h-4 w-4" />
                        <span className="sr-only">{t(navLabelKeys[item.label] ?? item.label as TranslationKey)}</span>
                      </Link>
                    </Button>
                    {item.href === "/settings" && hasUpdate && (
                      <span className={cn(
                        "absolute top-0.5 right-0.5 h-2 w-2 rounded-full",
                        readyToInstall ? "bg-[var(--success)] animate-pulse" : "bg-[var(--info)]"
                      )} />
                    )}
                  </div>
                )}
              </TooltipTrigger>
              <TooltipContent side="right">{t(navLabelKeys[item.label] ?? item.label as TranslationKey)}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Bottom: skip-permissions indicator + theme toggle */}
      <div className="mt-auto flex flex-col items-center gap-2">
        {skipPermissionsActive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex h-8 w-8 items-center justify-center">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-orange-500" />
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{t('nav.autoApproveOn')}</TooltipContent>
          </Tooltip>
        )}
        {mounted && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-8 w-8"
              >
                {theme === "dark" ? (
                  <HugeiconsIcon icon={Sun02Icon} className="h-4 w-4" />
                ) : (
                  <HugeiconsIcon icon={Moon02Icon} className="h-4 w-4" />
                )}
                <span className="sr-only">{t('nav.toggleTheme')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {theme === "dark" ? t('nav.lightMode') : t('nav.darkMode')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
