import { useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Folder01Icon,
  GitBranchIcon,
  Loading03Icon,
  PlusSignIcon,
  Settings02Icon,
  Sun01Icon,
  Moon01Icon,
} from '@hugeicons/core-free-icons';
import { useTheme } from 'next-themes';
import type { TranslationKey } from '@/i18n';
import { WorktreeItem } from '@/components/worktree/WorktreeItem';
import { cn } from '@/lib/utils';
import type { Worktree } from '@/types';

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

function getActiveNavClass(href: string) {
  void href;
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
  activeProjectPath: string;
  activeCheckoutPath: string;
  openingWorkspace: string | null;
  deletingWorkspacePath: string | null;
  expandedWorkspaces: Set<string>;
  worktreesByWorkspace: Record<string, Worktree[]>;
  gitWorkspacePaths: Record<string, boolean | undefined>;
  loadingWorktreePaths: Set<string>;
  worktreeSessionCounts: Record<string, number>;
  onOpenFolderPicker: () => void;
  onOpenWorkspace: (path: string) => void;
  onToggleWorkspaceExpand: (path: string) => void;
  onSetWorktreeCreateTarget: (path: string) => void;
  onWorkspaceContextMenu: (e: ReactMouseEvent, workspace: WorkspaceItem) => void;
  onWorktreeSelect: (workspacePath: string, worktree: Worktree) => void;
  onWorktreeDelete: (worktree: Worktree) => void;
  t: TranslateFn;
}

export function WorkspaceSection({
  collapsed,
  workspaceItems,
  activeProjectPath,
  activeCheckoutPath,
  openingWorkspace,
  deletingWorkspacePath,
  expandedWorkspaces,
  worktreesByWorkspace,
  gitWorkspacePaths,
  loadingWorktreePaths,
  worktreeSessionCounts,
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
            const isActiveProject = workspace.path === activeProjectPath;
            const isLocalActive = workspace.path === activeCheckoutPath;
            const isOpening = openingWorkspace === workspace.path;
            const isDeleting = deletingWorkspacePath === workspace.path;
            const isExpanded = expandedWorkspaces.has(workspace.path);
            const isGitWorkspace = gitWorkspacePaths[workspace.path] === true;
            const isLoadingWorktrees = loadingWorktreePaths.has(workspace.path);
            const workspaceWorktrees = worktreesByWorkspace[workspace.path] || [];
            const localWorktree = workspaceWorktrees.find((worktree) => worktree.is_default);
            const additionalWorktrees = workspaceWorktrees.filter(
              (worktree) => !worktree.is_default && !worktree.is_prunable,
            );
            const handleWorkspacePrimaryClick = () => {
              if (isOpening || isDeleting) return;
              onOpenWorkspace(workspace.path);
            };

            return (
              <div key={workspace.path} className="space-y-0.5">
                <div
                  className={cn(
                    'group relative flex w-full rounded-xl border text-left transition-all duration-200',
                    collapsed ? 'items-center justify-center px-1.5 py-2' : 'items-center gap-2 px-2.5 py-2',
                    isActiveProject
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
                    transform: isActiveProject ? 'scale(1.01)' : 'scale(1)',
                  }}
                >
                  {isActiveProject && !collapsed && (
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-sidebar-foreground/5 to-transparent opacity-50 pointer-events-none" />
                  )}

                  <button
                    type="button"
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-md transition-all duration-200 cursor-pointer',
                      'h-5 w-5',
                      isLocalActive
                        ? 'text-sidebar-foreground/90'
                        : 'text-sidebar-foreground/70 hover:text-sidebar-foreground/90'
                    )}
                    onClick={() => {
                      if (isOpening || isDeleting) return;
                      onOpenWorkspace(workspace.path);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Folder01Icon}
                      className="h-4 w-4"
                    />
                  </button>

                  {!collapsed && (
                    <>
                      <button
                        type="button"
                        className="relative flex min-w-0 flex-1 flex-col text-left cursor-pointer"
                        onClick={handleWorkspacePrimaryClick}
                        aria-label={workspace.name}
                      >
                        <span className="w-full truncate text-[12.5px] font-semibold leading-tight">
                          {workspace.name}
                        </span>
                        {localWorktree?.branch ? (
                          <span className="mt-0.5 w-full truncate text-[9.5px] text-sidebar-foreground/45">
                            {localWorktree.branch}
                          </span>
                        ) : null}
                      </button>

                      {isGitWorkspace ? (
                        <>
                          <button
                            type="button"
                            className="relative inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-md px-1 text-sidebar-foreground/52 transition-colors hover:bg-bg-tertiary hover:text-sidebar-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleWorkspaceExpand(workspace.path);
                            }}
                            aria-label={`${t('workspacePanel.worktrees')} · ${workspace.name}`}
                            title={t('workspacePanel.worktrees')}
                          >
                            {isLoadingWorktrees ? (
                              <HugeiconsIcon icon={Loading03Icon} className="h-3 w-3 animate-spin" />
                            ) : (
                              <HugeiconsIcon icon={GitBranchIcon} className="h-3 w-3" />
                            )}
                            {additionalWorktrees.length > 0 ? (
                              <span className="text-[9px] leading-none">{additionalWorktrees.length}</span>
                            ) : null}
                            <HugeiconsIcon
                              icon={isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
                              className="h-2.5 w-2.5"
                            />
                          </button>
                          <button
                            type="button"
                            className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/52 transition-colors hover:bg-bg-tertiary hover:text-sidebar-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSetWorktreeCreateTarget(workspace.path);
                            }}
                            aria-label={`${t('workspacePanel.newWorktree')} · ${workspace.name}`}
                            title={t('workspacePanel.newWorktree')}
                            data-testid={`new-worktree-${workspace.name}`}
                          >
                            <HugeiconsIcon icon={PlusSignIcon} className="h-3 w-3" />
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                </div>

                {!collapsed && isGitWorkspace && isExpanded ? (
                  <div className="ml-4 space-y-1 border-l border-border-subtle/50 py-1 pl-2">
                    {isLoadingWorktrees && additionalWorktrees.length === 0 ? (
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-sidebar-foreground/50">
                        <HugeiconsIcon icon={Loading03Icon} className="h-3 w-3 animate-spin" />
                        {t('workspacePanel.loadingBranches')}
                      </div>
                    ) : null}
                    {!isLoadingWorktrees && additionalWorktrees.length === 0 ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[10.5px] text-sidebar-foreground/52 transition-colors hover:bg-bg-tertiary hover:text-sidebar-foreground"
                        onClick={() => onSetWorktreeCreateTarget(workspace.path)}
                      >
                        <HugeiconsIcon icon={PlusSignIcon} className="h-3 w-3" />
                        {t('workspacePanel.noAdditionalWorktrees')}
                      </button>
                    ) : null}
                    {additionalWorktrees.map((worktree) => (
                      <WorktreeItem
                        key={worktree.id}
                        worktree={worktree}
                        isActive={worktree.worktree_path === activeCheckoutPath}
                        sessionCount={worktreeSessionCounts[worktree.worktree_path] || 0}
                        onSelect={(selected) => onWorktreeSelect(workspace.path, selected)}
                        onDelete={selected => onWorktreeDelete(selected)}
                      />
                    ))}
                  </div>
                ) : null}
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
  onCreateWorktree?: (workspacePath: string) => void;
  onCloseWorkspace: (workspace: WorkspaceItem) => void;
  isGitWorkspace?: boolean;
  t: TranslateFn;
}

export function WorkspaceContextMenu({
  contextMenuPosition,
  contextMenuWorkspace,
  onOpenInFinder,
  onCreateWorktree,
  onCloseWorkspace,
  isGitWorkspace = false,
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
        {isGitWorkspace && onCreateWorktree ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-sidebar-foreground/85 transition-colors hover:bg-bg-hover"
            onClick={() => onCreateWorktree(contextMenuWorkspace.path)}
          >
            <HugeiconsIcon icon={GitBranchIcon} className="h-3.5 w-3.5 opacity-70" />
            <span>{t('workspacePanel.newWorktree')}</span>
          </button>
        ) : null}
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
