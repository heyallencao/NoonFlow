'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, ZapIcon } from "@hugeicons/core-free-icons";
import type { SkillInfo } from './PluginCard';

interface PluginDetailProps {
  plugin: SkillInfo;
  onClose: () => void;
}

export function PluginDetail({ plugin, onClose }: PluginDetailProps) {
  const isProject = plugin.source === 'project';
  const displayName = isProject
    ? plugin.name.replace('project:', '')
    : plugin.name;

  return (
    <div className="rounded-lg p-4 bg-bg-tertiary">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={ZapIcon} className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold">/{displayName}</h3>
            <Badge variant={isProject ? 'secondary' : 'outline'}>
              {isProject ? 'Project' : 'Global'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {plugin.description}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" />
        </Button>
      </div>

      <Separator className="my-3" />

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium mb-1">Source</p>
          <p className="text-xs text-muted-foreground font-mono break-all">
            {plugin.filePath}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium mb-1">Type</p>
          <p className="text-xs text-muted-foreground">
            {isProject ? 'Project-level skill' : 'User-level skill'}
          </p>
        </div>

        <Separator />

        <div>
          <p className="text-sm font-medium mb-2">Content</p>
          <div className="rounded-md bg-muted p-3 max-h-80 overflow-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap break-words">
              {plugin.content}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
