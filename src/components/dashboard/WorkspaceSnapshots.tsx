'use client';

import { useWorkspaceStore } from '@/stores/workspace-store';
import { useTranslation } from '@/hooks/useTranslation';
import { FolderGit2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function WorkspaceSnapshots() {
  const { locale } = useTranslation();
  const router = useRouter();
  const workspacePaths = useWorkspaceStore((s) => s.workspacePaths);
  const hiddenWorkspaces = useWorkspaceStore((s) => s.hiddenWorkspaces);
  const visibleWorkspaces = workspacePaths.filter((workspace) => !hiddenWorkspaces.includes(workspace));

  if (visibleWorkspaces.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-[11px] font-semibold tracking-[0.2em] uppercase text-sidebar-foreground/40 mb-2">
        {locale === 'zh' ? '工作区快照' : 'Workspace Snapshots'}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleWorkspaces.map((ws) => {
          const name = ws.split('/').pop() || ws;
          return (
            <button
              key={ws}
              onClick={() => router.push('/repos')}
              className="flex items-center gap-4 py-3 group text-left border-b border-sidebar-foreground/5"
            >
               <FolderGit2 className="h-4 w-4 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/70 transition-colors shrink-0" />
               <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-sidebar-foreground/90 truncate group-hover:text-sidebar-foreground transition-colors">{name}</span>
                  <span className="text-[11px] text-sidebar-foreground/40 truncate mt-0.5">{ws}</span>
               </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
