'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  PlusSignIcon,
  Delete02Icon,
  Loading02Icon,
  ServerStack01Icon,
  Wifi01Icon,
  GlobeIcon,
  CubeIcon,
  PencilIcon,
  ArrowRight02Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { McpServerEditor } from '@/components/plugins/McpServerEditor';
import { ConfigEditor } from '@/components/plugins/ConfigEditor';
import { AutomationHeader } from '@/components/automation/AutomationHeader';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { MCPServer } from '@/types';
import type { IconSvgElement } from '@hugeicons/react';

type ViewTab = 'list' | 'json';
type ServerType = 'stdio' | 'sse' | 'http';

function getServerType(server: MCPServer): ServerType {
  return (server.type || (server.url ? 'http' : 'stdio')) as ServerType;
}

function getTypeInfo(type: ServerType) {
  switch (type) {
    case 'sse':
      return { label: 'SSE', icon: Wifi01Icon, color: 'bg-blue-500/10 text-blue-500' };
    case 'http':
      return { label: 'HTTP', icon: GlobeIcon, color: 'bg-emerald-500/10 text-emerald-500' };
    default:
      return { label: 'stdio', icon: ServerStack01Icon, color: 'bg-amber-500/10 text-amber-500' };
  }
}

function getServerDescription(server: MCPServer) {
  if (server.url) return server.url;
  const parts = [server.command, ...(server.args ?? [])].filter(Boolean);
  return parts.join(' ') || '(no command)';
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: IconSvgElement;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-secondary p-3.5 shadow-sm">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accent)}>
        <HugeiconsIcon icon={icon} className="h-5 w-5" />
      </div>
      <div>
        <div className="text-[1.3rem] font-semibold leading-none text-foreground">{value}</div>
        <div className="mt-1 text-[11px] font-medium text-muted-foreground/70">{label}</div>
      </div>
    </div>
  );
}

export function McpManager() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<Record<string, MCPServer>>({});
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | undefined>();
  const [editingServer, setEditingServer] = useState<MCPServer | undefined>();
  const [view, setView] = useState<ViewTab>('list');
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchServers = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/plugins/mcp');
      const data = await res.json();
      if (data.mcpServers) {
        setServers(data.mcpServers);
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      console.error('Failed to fetch MCP servers:', err);
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  function handleEdit(name: string, server: MCPServer) {
    setEditingName(name);
    setEditingServer(server);
    setEditorOpen(true);
  }

  function handleAdd() {
    setEditingName(undefined);
    setEditingServer(undefined);
    setEditorOpen(true);
  }

  async function handleDelete(name: string) {
    try {
      const res = await fetch(`/api/plugins/mcp/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setServers((prev) => {
          const updated = { ...prev };
          delete updated[name];
          return updated;
        });
        toast.success(t('mcp.deleteSuccess', { name }) || `Deleted "${name}"`);
      } else {
        const data = await res.json();
        toast.error(data.error || t('mcp.deleteFailed') || 'Failed to delete server');
      }
    } catch {
      toast.error(t('mcp.deleteFailed') || 'Failed to delete server');
    }
  }

  async function handleSave(name: string, server: MCPServer) {
    try {
      if (editingName && editingName !== name) {
        const updated = { ...servers };
        delete updated[editingName];
        updated[name] = server;
        const res = await fetch('/api/plugins/mcp', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mcpServers: updated }),
        });
        if (res.ok) {
          setServers(updated);
          toast.success(t('mcp.saveSuccess') || 'Server saved');
        } else {
          const data = await res.json();
          toast.error(data.error || 'Failed to save server');
        }
      } else if (editingName) {
        const updated = { ...servers, [name]: server };
        const res = await fetch('/api/plugins/mcp', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mcpServers: updated }),
        });
        if (res.ok) {
          setServers(updated);
          toast.success(t('mcp.saveSuccess') || 'Server saved');
        } else {
          const data = await res.json();
          toast.error(data.error || 'Failed to save server');
        }
      } else {
        const res = await fetch('/api/plugins/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, server }),
        });
        if (res.ok) {
          setServers((prev) => ({ ...prev, [name]: server }));
          toast.success(t('mcp.addSuccess') || 'Server added');
        } else {
          const data = await res.json();
          toast.error(data.error || 'Failed to add server');
        }
      }
    } catch {
      toast.error(t('mcp.saveFailed') || 'Failed to save server');
    }
  }

  async function handleJsonSave(jsonStr: string) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        toast.error('Configuration must be a JSON object');
        return;
      }
      const res = await fetch('/api/plugins/mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpServers: parsed }),
      });
      if (res.ok) {
        setServers(parsed as Record<string, MCPServer>);
        toast.success(t('mcp.saveSuccess') || 'Configuration saved');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save configuration');
      }
    } catch {
      toast.error('Invalid JSON configuration');
    }
  }

  const entries = useMemo(() => Object.entries(servers), [servers]);
  const serverCount = entries.length;

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.trim().toLowerCase();
    return entries.filter(([name, server]) =>
      name.toLowerCase().includes(q) ||
      getServerDescription(server).toLowerCase().includes(q),
    );
  }, [entries, searchQuery]);

  const typeCounts = useMemo(() => {
    const counts = { stdio: 0, http: 0, sse: 0 };
    for (const [, s] of entries) {
      counts[getServerType(s)]++;
    }
    return counts;
  }, [entries]);

  const grouped = useMemo(() => {
    const groups: { key: string; title: string; icon: IconSvgElement; color: string; items: [string, MCPServer][] }[] = [];
    const byType: Record<ServerType, [string, MCPServer][]> = { stdio: [], http: [], sse: [] };
    for (const entry of filteredEntries) {
      byType[getServerType(entry[1])].push(entry);
    }
    if (byType.stdio.length > 0) {
      const info = getTypeInfo('stdio');
      groups.push({ key: 'stdio', title: info.label, icon: info.icon, color: info.color, items: byType.stdio });
    }
    if (byType.http.length > 0) {
      const info = getTypeInfo('http');
      groups.push({ key: 'http', title: info.label, icon: info.icon, color: info.color, items: byType.http });
    }
    if (byType.sse.length > 0) {
      const info = getTypeInfo('sse');
      groups.push({ key: 'sse', title: info.label, icon: info.icon, color: info.color, items: byType.sse });
    }
    return groups;
  }, [filteredEntries]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm font-medium text-muted-foreground">{t('mcp.loadingServers')}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <AutomationHeader
        title="MCP"
        description={t('mcp.pageDescription') || 'Configure Model Context Protocol servers to extend AI capabilities with custom tools and resources.'}
        action={
          <Button size="sm" className="h-9 rounded-lg text-[12px] font-bold shadow-md hover:shadow-lg transition-all" onClick={handleAdd}>
            <HugeiconsIcon icon={PlusSignIcon} className="mr-1.5 h-4 w-4" />
            {t('mcp.addServer')}
          </Button>
        }
      />

      {/* Stats strip — only show when there are servers */}
      {serverCount > 0 && (
        <div className="shrink-0 border-b border-border-subtle bg-bg-primary px-6 py-3">
          <div className="grid grid-cols-4 gap-3">
            <StatCard label={t('mcp.statTotal') || 'Total Servers'} value={serverCount} icon={CubeIcon} accent="bg-violet-500/10 text-violet-500" />
            <StatCard label="stdio" value={typeCounts.stdio} icon={ServerStack01Icon} accent="bg-amber-500/10 text-amber-500" />
            <StatCard label="HTTP" value={typeCounts.http} icon={GlobeIcon} accent="bg-emerald-500/10 text-emerald-500" />
            <StatCard label="SSE" value={typeCounts.sse} icon={Wifi01Icon} accent="bg-blue-500/10 text-blue-500" />
          </div>
        </div>
      )}

      {/* Search + View toggle */}
      {serverCount > 0 && (
        <div className="shrink-0 flex items-center gap-3 border-b border-border-subtle bg-bg-primary px-6 py-2.5">
          <div className="relative flex-1 max-w-sm">
            <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/50" />
            <Input
              placeholder={t('mcp.searchPlaceholder') || 'Search servers...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9 text-[13px] bg-bg-secondary border-border-subtle rounded-lg shadow-sm"
            />
          </div>
          <div className="flex items-center rounded-lg border border-border-subtle bg-bg-secondary p-1 shadow-sm">
            <button
              onClick={() => setView('list')}
              className={cn(
                'rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all',
                view === 'list' ? 'bg-bg-hover text-foreground shadow-sm' : 'text-muted-foreground/70 hover:text-foreground',
              )}
            >
              {t('mcp.listTab')}
            </button>
            <button
              onClick={() => setView('json')}
              className={cn(
                'rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all',
                view === 'json' ? 'bg-bg-hover text-foreground shadow-sm' : 'text-muted-foreground/70 hover:text-foreground',
              )}
            >
              {t('mcp.jsonTab')}
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6 custom-scrollbar">
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {view === 'json' ? (
          <ConfigEditor
            value={JSON.stringify(servers, null, 2)}
            onSave={handleJsonSave}
            label={t('mcp.serverConfig')}
          />
        ) : serverCount === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center w-full h-full">
            <HugeiconsIcon icon={CubeIcon} className="h-12 w-12 text-muted-foreground/20 mb-4" />
            <p className="text-[14px] font-bold text-foreground">{t('mcp.noServers')}</p>
            <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">{t('mcp.noServersDesc')}</p>
            <Button size="sm" className="mt-4 h-9 rounded-lg text-[12px] font-bold" onClick={handleAdd}>
              <HugeiconsIcon icon={PlusSignIcon} className="mr-1.5 h-4 w-4" />
              {t('mcp.addServer')}
            </Button>
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center w-full h-full">
            <HugeiconsIcon icon={CubeIcon} className="h-12 w-12 text-muted-foreground/20 mb-4" />
            <p className="text-[14px] font-bold text-foreground">{t('mcp.noSearchResult') || 'No matching servers'}</p>
            <p className="mt-1 max-w-xs text-[12px] text-muted-foreground">
              {t('mcp.noSearchResultDesc') || 'Try a different search query.'}
            </p>
          </div>
        ) : (
          <div className="space-y-10 pb-12">
            {grouped.map((group) => (
              <section key={group.key} className="space-y-3">
                <div className="mb-4 flex items-center gap-2">
                  <div className={cn('flex h-6 w-6 items-center justify-center rounded-lg', group.color)}>
                    <HugeiconsIcon icon={group.icon} className="h-4 w-4" />
                  </div>
                  <h2 className="text-[15px] font-bold text-foreground">{group.title}</h2>
                  <span className="rounded-md bg-muted/20 px-1.5 py-0.5 text-xs text-muted-foreground/60">
                    {group.items.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {group.items.map(([name, server]) => {
                    const serverType = getServerType(server);
                    const typeInfo = getTypeInfo(serverType);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleEdit(name, server)}
                        className="group flex w-full items-center gap-4 rounded-2xl border border-transparent bg-bg-secondary p-4 text-left transition-all hover:border-white/5 hover:bg-bg-hover hover:shadow-sm"
                      >
                        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', typeInfo.color)}>
                          <HugeiconsIcon icon={typeInfo.icon} className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[14px] font-bold leading-tight text-foreground">{name}</span>
                            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                              {typeInfo.label}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-[12px] font-mono leading-normal text-muted-foreground">
                            {getServerDescription(server)}
                          </p>
                          {server.env && Object.keys(server.env).length > 0 && (
                            <div className="mt-1.5 flex gap-1 flex-wrap">
                              {Object.keys(server.env).map((key) => (
                                <span key={key} className="rounded bg-muted/30 px-1 py-0.5 text-[10px] text-muted-foreground/60">{key}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/60">
                            <HugeiconsIcon icon={PencilIcon} className="h-3.5 w-3.5" />
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setPendingDelete(name); }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <HugeiconsIcon
                          icon={ArrowRight02Icon}
                          className="shrink-0 h-4 w-4 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/60"
                        />
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <McpServerEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        name={editingName}
        server={editingServer}
        onSave={handleSave}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent className="border-border-default bg-bg-secondary text-sidebar-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mcp.deleteConfirmTitle') || 'Delete MCP Server'}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mcp.deleteConfirmDesc', { name: pendingDelete ?? '' }) || `Are you sure you want to delete "${pendingDelete}"? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                const name = pendingDelete;
                setPendingDelete(null);
                if (name) void handleDelete(name);
              }}
            >
              {t('mcp.deleteAction') || 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
