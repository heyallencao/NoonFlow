'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PluginCard, type SkillInfo } from './PluginCard';
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, GlobeIcon, FolderOpenIcon, Plug01Icon } from "@hugeicons/core-free-icons";

interface PluginListProps {
  plugins: SkillInfo[];
  onSelect: (plugin: SkillInfo) => void;
}

export function PluginList({ plugins, onSelect }: PluginListProps) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'global' | 'project' | 'plugin'>('all');

  const filtered = plugins.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase());
    if (sourceFilter === 'all') return matchesSearch;
    return matchesSearch && p.source === sourceFilter;
  });

  const globalCount = plugins.filter((p) => p.source === 'global').length;
  const projectCount = plugins.filter((p) => p.source === 'project').length;
  const pluginCount = plugins.filter((p) => p.source === 'plugin').length;

  return (
    <div className="space-y-4">
      <div className="relative">
        <HugeiconsIcon icon={Search01Icon} className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills by name..."
          className="pl-9"
        />
      </div>

      <Tabs
        value={sourceFilter}
        onValueChange={(v) => setSourceFilter(v as 'all' | 'global' | 'project' | 'plugin')}
      >
        <TabsList>
          <TabsTrigger value="all">
            All ({plugins.length})
          </TabsTrigger>
          <TabsTrigger value="global" className="gap-1.5">
            <HugeiconsIcon icon={GlobeIcon} className="h-3.5 w-3.5" />
            Global ({globalCount})
          </TabsTrigger>
          <TabsTrigger value="project" className="gap-1.5">
            <HugeiconsIcon icon={FolderOpenIcon} className="h-3.5 w-3.5" />
            Project ({projectCount})
          </TabsTrigger>
          {pluginCount > 0 && (
            <TabsTrigger value="plugin" className="gap-1.5">
              <HugeiconsIcon icon={Plug01Icon} className="h-3.5 w-3.5" />
              Plugin ({pluginCount})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value={sourceFilter} className="mt-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-sm">
                {plugins.length === 0
                  ? 'No skills found'
                  : 'No matching skills'}
              </p>
              <p className="text-xs mt-1">
                {plugins.length === 0
                  ? 'Add .md files to ~/.claude/commands/ or .claude/commands/ to create skills'
                  : 'Try adjusting your search or filter'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filtered.map((plugin) => (
                <PluginCard
                  key={plugin.name}
                  plugin={plugin}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
