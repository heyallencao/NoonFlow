'use client';

/**
 * RightPanel Redesign
 *
 * Design Direction: Industrial Utilitarian
 * - Consistent typography scale (12px base)
 * - Unified component rhythm (8px grid)
 * - Clear visual hierarchy
 * - Improved touch targets (min 32px)
 *
 * Key Changes:
 * - Standardized icon size: 16px (h-4 w-4)
 * - Standardized button size: 32px (h-8 w-8)
 * - Consistent spacing: 12px/16px/24px
 * - Unified font size: text-xs (12px) for UI elements
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Activity01Icon,
  PanelRightCloseIcon,
  Shield01Icon,
} from '@hugeicons/core-free-icons';
import { ListTodo } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { FileTree } from '@/components/project/FileTree';
import { TaskList } from '@/components/project/TaskList';
import { publishAttachFileToChat, subscribeOpenFilePreview, subscribeTasksUpdated } from '@/lib/events/app-event-bus';
import { PermissionCenter } from '@/components/permission/PermissionCenter';
import { ToolExecutionPanel } from '@/components/tools/ToolExecutionPanel';
import { buildToolExecutionSummaries, useRuntimeStore } from '@/stores/runtime-store';
import { cn } from '@/lib/utils';
import type { TaskItem } from '@/types';

type InspectorPanel = 'tasks' | 'permissions' | 'tools' | null;

interface RightPanelProps {
  width?: number;
}

export function RightPanel({ width }: RightPanelProps) {
  const {
    panelOpen,
    setPanelOpen,
    workingDirectory,
    sessionId,
    previewFile,
    setPreviewFile,
  } = usePanel();
  const { t } = useTranslation();
  const [activeInspector, setActiveInspector] = useState<InspectorPanel>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const snapshot = useRuntimeStore((state) => state.snapshots[sessionId] ?? null);
  const toolExecutions = useMemo(() => buildToolExecutionSummaries(snapshot), [snapshot]);
  const pendingPermission = snapshot?.pendingPermission ?? null;
  const permissionResolved = snapshot?.permissionResolved ?? null;
  const runningTools = toolExecutions.filter((tool) => tool.status === 'running' || tool.status === 'pending').length;
  const errorTools = toolExecutions.filter((tool) => tool.status === 'error').length;
  const completedTaskCount = tasks.filter((task) => task.status === 'completed').length;
  const totalTaskCount = tasks.length;
  const taskBadge = totalTaskCount > 0 ? `${completedTaskCount}/${totalTaskCount}` : '';

  const fetchTasks = useCallback(async () => {
    if (!sessionId) {
      setTasks([]);
      return;
    }

    try {
      const res = await fetch(`/api/tasks?session_id=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json() as { tasks?: TaskItem[] };
      setTasks(data.tasks || []);
    } catch {
      // ignore task badge refresh failures
    }
  }, [sessionId]);

  const handleFileAdd = useCallback((path: string) => {
    publishAttachFileToChat({ path });
  }, []);

  const handleFileSelect = useCallback((path: string) => {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    const nonPreviewable = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg', 'avif',
      'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv',
      'mp3', 'wav', 'ogg', 'flac', 'aac', 'wma',
      'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'exe', 'dll', 'so', 'dylib', 'bin', 'dmg', 'iso',
      'woff', 'woff2', 'ttf', 'otf', 'eot',
    ]);
    if (nonPreviewable.has(ext)) return;

    if (previewFile === path) {
      setPreviewFile(null);
    } else {
      setPreviewFile(path);
    }
  }, [previewFile, setPreviewFile]);

  const toggleInspector = useCallback((panel: Exclude<InspectorPanel, null>) => {
    setActiveInspector((current) => current === panel ? null : panel);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenFilePreview(({ path }) => {
      if (!path) return;
      setPanelOpen(true);
      setPreviewFile(path);
    });
    return unsubscribe;
  }, [setPanelOpen, setPreviewFile]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchTasks();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fetchTasks]);

  useEffect(() => {
    return subscribeTasksUpdated(() => {
      void fetchTasks();
    });
  }, [fetchTasks]);

  if (!panelOpen) return null;

  return (
    <aside
      className="relative hidden h-full shrink-0 flex-col overflow-hidden bg-transparent text-sidebar-foreground lg:flex shadow-[-4px_0_24px_-12px_rgba(0,0,0,0.2)] z-10 mr-2"
      style={{ width: width ?? 288 }}
    >
      <div className="relative flex h-full flex-col">
        {/* Header - Unified spacing and typography */}
        <div className="flex h-14 shrink-0 items-center justify-end px-4">
          <div className="flex items-center gap-2">
            {/* Unified button style: 32px touch target, 16px icon */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Toggle tasks"
                  aria-pressed={activeInspector === 'tasks'}
                  className={cn(
                    'relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                    activeInspector === 'tasks'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-foreground/5 text-sidebar-foreground/75 hover:bg-foreground/10 hover:text-sidebar-foreground',
                  )}
                  onClick={() => toggleInspector('tasks')}
                >
                  <ListTodo className="h-4 w-4" />
                  {taskBadge ? (
                    <span
                      className="absolute -right-1.5 -top-1.5 flex min-w-[24px] items-center justify-center rounded-full border-2 border-bg-secondary bg-emerald-400 px-1.5 text-[10px] font-bold leading-none text-emerald-950"
                    >
                      {taskBadge}
                    </span>
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {taskBadge ? `${t('panel.tasks')} ${taskBadge}` : t('panel.tasks')}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="right-panel-permission-toggle"
                  aria-label="Toggle permission center"
                  aria-pressed={activeInspector === 'permissions'}
                  className={cn(
                    'relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                    activeInspector === 'permissions'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-foreground/5 text-sidebar-foreground/75 hover:bg-foreground/10 hover:text-sidebar-foreground',
                  )}
                  onClick={() => toggleInspector('permissions')}
                >
                  <HugeiconsIcon icon={Shield01Icon} className="h-4 w-4" />
                  {(pendingPermission || permissionResolved) && (
                    <span
                      className={cn(
                        'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-bg-secondary',
                        pendingPermission && 'bg-amber-400',
                        permissionResolved === 'allow' && 'bg-emerald-400',
                        permissionResolved === 'deny' && 'bg-red-400',
                      )}
                    />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {pendingPermission
                  ? 'Permission request pending'
                  : permissionResolved
                    ? 'Permission history'
                    : 'Permission center'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="right-panel-tools-toggle"
                  aria-label="Toggle tool execution"
                  aria-pressed={activeInspector === 'tools'}
                  className={cn(
                    'relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200',
                    activeInspector === 'tools'
                      ? 'bg-blue-500/15 text-blue-300'
                      : 'bg-foreground/5 text-sidebar-foreground/75 hover:bg-foreground/10 hover:text-sidebar-foreground',
                  )}
                  onClick={() => toggleInspector('tools')}
                >
                  <HugeiconsIcon icon={Activity01Icon} className="h-4 w-4" />
                  {(runningTools > 0 || errorTools > 0) && (
                    <span
                      className={cn(
                        'absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full border-2 border-bg-secondary px-1 text-[10px] font-bold leading-none',
                        errorTools > 0 ? 'bg-red-400 text-red-950' : 'bg-blue-400 text-blue-950',
                      )}
                    >
                      {errorTools > 0 ? errorTools : runningTools}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {errorTools > 0
                  ? `${errorTools} tool errors`
                  : runningTools > 0
                    ? `${runningTools} tools running`
                    : 'Tool execution'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('panel.closePanel')}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/5 text-sidebar-foreground/75 transition-all duration-200 hover:bg-foreground/10 hover:text-sidebar-foreground"
                  onClick={() => setPanelOpen(false)}
                >
                  <HugeiconsIcon icon={PanelRightCloseIcon} className="h-4 w-4" />
                  <span className="sr-only">{t('panel.closePanel')}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">{t('panel.closePanel')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Inspector Panel - Improved positioning and styling */}
        {activeInspector && (
          <div className="pointer-events-none absolute right-4 top-16 z-20 flex w-[min(360px,calc(100%-2rem))] justify-end">
            <div className="pointer-events-auto max-h-[min(60vh,480px)] w-full overflow-auto rounded-xl border border-border-default bg-background p-4 shadow-xl">
              {activeInspector === 'tasks' ? (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
                    <ListTodo className="h-4 w-4 text-sidebar-foreground/75" />
                    <span>{t('panel.tasks')}</span>
                  </div>
                  <TaskList sessionId={sessionId} />
                </section>
              ) : activeInspector === 'permissions' ? (
                <PermissionCenter sessionId={sessionId} />
              ) : (
                <ToolExecutionPanel sessionId={sessionId} />
              )}
            </div>
          </div>
        )}

        {/* Divider removed for a cleaner look */}
        <div className="mx-4 mb-1" />

        {/* File Tree - Full height */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <FileTree
            key={workingDirectory || '__empty-workspace__'}
            workingDirectory={workingDirectory}
            onFileSelect={handleFileSelect}
            onFileAdd={handleFileAdd}
          />
        </div>
      </div>
    </aside>
  );
}
