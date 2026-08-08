import { useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Folder01Icon,
  FolderOpenIcon,
  PlusSignIcon,
  Settings02Icon,
  Sun01Icon,
  Moon01Icon,
} from '@hugeicons/core-free-icons';
import { useTheme } from 'next-themes';
import type { TranslationKey } from '@/i18n';
import { WorktreeItem } from '@/components/worktree/WorktreeItem';
import type { Worktree } from '@/types';
import { cn } from '@/lib/utils';

const DEFAULT_THEME_TOGGLE_ICON = Moon01Icon;

export interface WorkspaceItem {
  path: string;
  name: string;
  sessionCount: number;
  latestUpdatedAt: number;
  latestSessionId?: string | null;
}

type TranslateFn = (
  key: TranslationKey,
  params?: Record<string, string | number>
) => string;

export interface SidebarGroupConfig {
  titleKey: TranslationKey;
  items: ReadonlyArray<{
    href: string;
    labelKey: TranslationKey;
    icon: IconSvgElement;
  }>;
}

interface SidebarHeaderProps {
  collapsed: boolean;
  isSettingsRoute: boolean;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
  onToggleCollapsed: () => void;
  t: TranslateFn;
}

export function SidebarHeader({
  collapsed,
  isSettingsRoute,
  isMobileOpen = false,
  onMobileClose,
  onToggleCollapsed,
  t,
}: SidebarHeaderProps) {
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
  const { theme, setTheme } = useTheme();
  const themeReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const shouldShowMobileClose = isMobileOpen && typeof onMobileClose === 'function';
  const toggleLabel = shouldShowMobileClose
    ? t('nav.closeSidebar')
    : collapsed
      ? t('sidebar.expand')
      : t('sidebar.collapse');

  return (
    <div
      className={cn(
        'mb-3 flex items-center',
        collapsed ? '-mt-1 flex-col justify-center gap-0.5 px-1' : 'justify-between px-6'
      )}
      data-window-drag-region
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <h1
        className={cn(
          'font-semibold tracking-[0.04em] text-sidebar-foreground/95',
          collapsed ? '-mt-0.5 text-[14px] leading-none' : 'text-[17px]'
        )}
      >
        {collapsed ? 'N' : 'NoonFlow'}
      </h1>
      <div className={cn('flex items-center gap-1', collapsed && 'mt-0.5 flex-col')}>
        <button
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/72 transition-colors hover:bg-bg-hover hover:text-sidebar-foreground"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={t('nav.toggleTheme')}
          title={t('nav.toggleTheme')}
          style={noDragStyle}
        >
          <HugeiconsIcon
            icon={themeReady && theme === 'dark' ? Sun01Icon : DEFAULT_THEME_TOGGLE_ICON}
            className="h-3.5 w-3.5"
          />
        </button>
        <Link
          href="/settings"
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors',
            isSettingsRoute
              ? 'bg-bg-hover text-sidebar-foreground'
              : 'text-sidebar-foreground/72 hover:bg-bg-hover hover:text-sidebar-foreground'
          )}
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
          style={noDragStyle}
        >
          <HugeiconsIcon icon={Settings02Icon} className="h-3.5 w-3.5" />
        </Link>
        <button
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sidebar-foreground/72 transition-colors hover:bg-bg-hover hover:text-sidebar-foreground"
          onClick={shouldShowMobileClose ? onMobileClose : onToggleCollapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          style={noDragStyle}
        >
          <HugeiconsIcon
            icon={shouldShowMobileClose ? Cancel01Icon : collapsed ? ArrowRight01Icon : ArrowLeft01Icon}
            className="h-3.5 w-3.5"
          />
        </button>
      </div>
    </div>
  );
}

interface SidebarNavigationProps {
  collapsed: boolean;
  pathname: string;
  groups: ReadonlyArray<SidebarGroupConfig>;
  t: TranslateFn;
}

const SESSIONS_MATCHED_SHADOW =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_28px_-18px_rgba(96,165,250,0.42)]';

function getActiveNavClass(href: string) {
  const sessionsMatchedRoutes = new Set([
    '/sessions',
    '/repos',
    '/timeline',
    '/work-graph',
    '/hygiene',
  ]);

  if (sessionsMatchedRoutes.has(href)) {
    return `bg-bg-hover text-sidebar-foreground ${SESSIONS_MATCHED_SHADOW}`;
  }

  return 'bg-bg-hover text-sidebar-foreground';
}

export function SidebarNavigation({
  collapsed,
  pathname,
  groups,
  t,
}: SidebarNavigationProps) {
  return (
    <>
      {groups.map((group, i) => (
        <div
          key={group.titleKey}
          className={cn('mb-5', collapsed ? 'px-2' : 'px-3', i === 0 && 'mt-2')}
        >
          {!collapsed && (
            <h3 className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-sidebar-foreground/55">
              {t(group.titleKey)}
            </h3>
          )}
          <div className={cn(collapsed ? 'space-y-1' : 'space-y-[2px]')}>
            {group.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.labelKey}
                  href={item.href}
                  className={cn(
                    'flex rounded-xl transition-all duration-200',
                    collapsed
                      ? 'justify-center px-2 py-2'
                      : 'items-center gap-3 px-3 py-1.5 text-[13px] font-medium',
                    isActive
                      ? getActiveNavClass(item.href)
                      : 'text-sidebar-foreground/82 hover:bg-bg-tertiary hover:text-sidebar-foreground'
                  )}
                  title={collapsed ? t(item.labelKey) : undefined}
                >
                  <HugeiconsIcon icon={item.icon} className="h-[16px] w-[16px] shrink-0 opacity-85" />
                  {collapsed ? <span className="sr-only">{t(item.labelKey)}</span> : t(item.labelKey)}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

interface WorkspaceSectionProps {
  collapsed: boolean;
  workspaceItems: WorkspaceItem[];
  activeWorkspace: string;
  openingWorkspace: string | null;
  deletingWorkspacePath: string | null;
  expandedWorkspaces: Set<string>;
  worktreesByWorkspace: Record<string, Worktree[]>;
  worktreeSessionCounts: Record<string, number>;
  activeWorktreeId: string | null;
  onOpenFolderPicker: () => void;
  onOpenWorkspace: (path: string) => void;
  onToggleWorkspaceExpand: (path: string) => void;
  onSetWorktreeCreateTarget: (path: string) => void;
  onWorkspaceContextMenu: (e: ReactMouseEvent, workspace: WorkspaceItem) => void;
  onWorktreeSelect: (worktree: Worktree) => void;
  onWorktreeDelete: (worktree: Worktree) => void;
  t: TranslateFn;
}

export function WorkspaceSection({
  collapsed,
  workspaceItems,
  activeWorkspace,
  openingWorkspace,
  deletingWorkspacePath,
  expandedWorkspaces,
  worktreesByWorkspace,
  worktreeSessionCounts,
  activeWorktreeId,
  onOpenFolderPicker,
  onOpenWorkspace,
  onToggleWorkspaceExpand,
  onSetWorktreeCreateTarget,
  onWorkspaceContextMenu,
  onWorktreeSelect,
  onWorktreeDelete,
  t,
}: WorkspaceSectionProps) {
  return (
    <div className={cn('mb-3', collapsed ? 'px-2' : 'px-3')}>
      <div className={cn('mb-2 flex items-center', collapsed ? 'justify-center' : 'justify-between px-3')}>
        {!collapsed && (
          <h3 className="text-[11px] font-semibold tracking-wider text-sidebar-foreground/55">
            {t('workspacePanel.title')}
          </h3>
        )}
        <button
          className={cn(
            'inline-flex items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-bg-hover hover:text-sidebar-foreground',
            collapsed ? 'h-7 w-7' : 'h-5 w-5'
          )}
          onClick={onOpenFolderPicker}
          aria-label={t('workspacePanel.addWorkspace')}
          title={t('workspacePanel.addWorkspace')}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1">
        {workspaceItems.length === 0 ? (
          collapsed ? (
            <div className="flex items-center justify-center rounded-lg border border-border-subtle bg-bg-tertiary py-2 text-sidebar-foreground/52">
              <HugeiconsIcon icon={Folder01Icon} className="h-4 w-4" />
            </div>
          ) : (
            <div className="rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-2 text-[11px] text-sidebar-foreground/64">
              {t('workspacePanel.noWorkspaces')}
            </div>
          )
        ) : (
          workspaceItems.map((workspace) => {
            const isActive = workspace.path === activeWorkspace;
            const isOpening = openingWorkspace === workspace.path;
            const isDeleting = deletingWorkspacePath === workspace.path;
            const isExpanded = expandedWorkspaces.has(workspace.path);
            const wsWorktrees = worktreesByWorkspace[workspace.path] || [];
            const hasExpandableWorktrees = wsWorktrees.some(
              (worktree) => !worktree.is_default || Boolean(worktree.branch?.trim())
            );
            const handleWorkspacePrimaryClick = () => {
              if (isOpening || isDeleting) return;
              if (collapsed) {
                onOpenWorkspace(workspace.path);
                return;
              }
              if (isActive && (isExpanded || hasExpandableWorktrees)) {
                onToggleWorkspaceExpand(workspace.path);
                return;
              }
              onOpenWorkspace(workspace.path);
            };

            return (
              <div key={workspace.path} className="space-y-0.5">
                <div
                  className={cn(
                    'group relative flex w-full rounded-xl border text-left transition-all duration-200',
                    collapsed ? 'items-center justify-center px-1.5 py-2' : 'items-center gap-2 px-2.5 py-2',
                    isActive
                      ? 'border-border-default/60 bg-gradient-to-br from-bg-hover to-bg-hover/60 text-sidebar-foreground shadow-sm'
                      : 'border-transparent bg-bg-tertiary/60 text-sidebar-foreground/85 hover:border-border-subtle/40 hover:bg-bg-hover/40 hover:shadow-sm',
                    (isOpening || isDeleting) && 'opacity-70'
                  )}
                  title={
                    collapsed
                      ? workspace.name
                      : workspace.name
                  }
                  onContextMenu={(e) => onWorkspaceContextMenu(e, workspace)}
                  role="group"
                  style={{
                    transform: isActive ? 'scale(1.01)' : 'scale(1)',
                  }}
                >
                  {isActive && !collapsed && (
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-sidebar-foreground/5 to-transparent opacity-50 pointer-events-none" />
                  )}

                  <button
                    type="button"
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-md transition-all duration-200 cursor-pointer',
                      'h-5 w-5',
                      isActive
                        ? 'text-sidebar-foreground/90'
                        : 'text-sidebar-foreground/70 hover:text-sidebar-foreground/90'
                    )}
                    onClick={() => {
                      if (isOpening || isDeleting) return;
                      if (collapsed) {
                        onOpenWorkspace(workspace.path);
                      } else {
                        onToggleWorkspaceExpand(workspace.path);
                      }
                    }}
                  >
                    <HugeiconsIcon
                      icon={isExpanded ? FolderOpenIcon : Folder01Icon}
                      className="h-4 w-4"
                    />
                  </button>

                  {!collapsed && (
                    <>
                      <button
                        type="button"
                        className="relative flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer"
                        onClick={handleWorkspacePrimaryClick}
                      >
                        <span className="truncate text-[12.5px] font-semibold leading-tight">
                          {workspace.name}
                        </span>
                      </button>

                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-200',
                          'text-sidebar-foreground/50',
                          'hover:bg-bg-tertiary/80 hover:text-sidebar-foreground/90'
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetWorktreeCreateTarget(workspace.path);
                        }}
                        aria-label={t('workspacePanel.newWorktree')}
                        title={t('workspacePanel.newWorktree')}
                      >
                        <HugeiconsIcon icon={PlusSignIcon} className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>

                {!collapsed && isExpanded && (
                  <div
                    className="ml-4 mt-2 space-y-1.5 overflow-hidden"
                    style={{
                      animation: 'slideDown 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
                    }}
                  >
                    <div className="relative pl-3">
                      <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-border-subtle/60 via-border-subtle/30 to-transparent" />

                      <div className="space-y-1">
                        {wsWorktrees.map((wt, idx) => {
                          const wtSessionCount = worktreeSessionCounts[wt.id] ?? 0;
                          return (
                            <div
                              key={wt.id}
                              style={{
                                animation: `fadeInUp 0.3s cubic-bezier(0.25, 1, 0.5, 1) ${idx * 0.05}s both`,
                              }}
                            >
                              <WorktreeItem
                                worktree={wt}
                                isActive={activeWorktreeId === wt.id}
                                sessionCount={wtSessionCount}
                                onSelect={onWorktreeSelect}
                                onDelete={onWorktreeDelete}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface WorkspaceContextMenuProps {
  contextMenuPosition: { x: number; y: number } | null;
  contextMenuWorkspace: WorkspaceItem | null;
  onOpenInFinder: (workspacePath: string) => void;
  onCloseWorkspace: (workspace: WorkspaceItem) => void;
  t: TranslateFn;
}

export function WorkspaceContextMenu({
  contextMenuPosition,
  contextMenuWorkspace,
  onOpenInFinder,
  onCloseWorkspace,
  t,
}: WorkspaceContextMenuProps) {
  if (!contextMenuPosition || !contextMenuWorkspace) {
    return null;
  }

  return (
    <div
      className="fixed z-[80] min-w-[180px] rounded-lg border border-border-default bg-bg-secondary shadow-lg"
      style={{
        left: contextMenuPosition.x,
        top: contextMenuPosition.y,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="py-1">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-sidebar-foreground/85 transition-colors hover:bg-bg-hover"
          onClick={() => onOpenInFinder(contextMenuWorkspace.path)}
        >
          <HugeiconsIcon icon={Folder01Icon} className="h-3.5 w-3.5 opacity-70" />
          <span>{t('workspacePanel.openInFinder')}</span>
        </button>
        <div className="my-1 h-px bg-border-subtle/50" />
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-red-400/90 transition-colors hover:bg-red-500/10"
          onClick={() => onCloseWorkspace(contextMenuWorkspace)}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
          <span>{t('workspacePanel.closeWorkspace')}</span>
        </button>
      </div>
    </div>
  );
}
