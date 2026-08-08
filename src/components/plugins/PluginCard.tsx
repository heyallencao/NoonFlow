'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, ZapIcon } from "@hugeicons/core-free-icons";

export interface SkillInfo {
  name: string;
  description: string;
  source: 'global' | 'project' | 'plugin';
  content: string;
  filePath: string;
  enabled: boolean;
}

interface PluginCardProps {
  plugin: SkillInfo;
  onSelect: (plugin: SkillInfo) => void;
}

export function PluginCard({ plugin, onSelect }: PluginCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isProject = plugin.source === 'project';
  const isPlugin = plugin.source === 'plugin';
  const displayName = isProject
    ? plugin.name.replace('project:', '')
    : plugin.name;

  return (
    <Card className="transition-colors hover:bg-white/[0.04]">
      <CardHeader
        className="flex flex-row items-start justify-between space-y-0 pb-3 cursor-pointer"
        onClick={() => onSelect(plugin)}
      >
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-2 mb-1">
            <HugeiconsIcon icon={ZapIcon} className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-sm font-medium truncate">
              /{displayName}
            </CardTitle>
            <Badge
              variant={isProject ? 'secondary' : 'outline'}
              className="text-xs shrink-0"
            >
              {isPlugin ? 'Plugin' : isProject ? 'Project' : 'Global'}
            </Badge>
          </div>
          <CardDescription className="text-xs line-clamp-2">
            {plugin.description}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? (
            <HugeiconsIcon icon={ArrowUp01Icon} className="h-4 w-4" />
          ) : (
            <HugeiconsIcon icon={ArrowDown01Icon} className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <div className="rounded-md bg-muted p-3 max-h-60 overflow-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap break-words">
              {plugin.content}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground mt-2 font-mono truncate">
            {plugin.filePath}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
