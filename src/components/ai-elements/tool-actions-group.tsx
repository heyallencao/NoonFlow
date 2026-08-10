'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  File01Icon,
  FileEditIcon,
  CommandLineIcon,
  Search01Icon,
  Wrench01Icon,
  Loading02Icon,
  CheckmarkCircle02Icon,
  CancelCircleIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from '@/lib/utils';
import { FileDiffView } from './file-diff-view';
import { publishOpenFilePreview } from '@/lib/events/app-event-bus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolAction {
  id?: string;
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
}

interface ToolActionsGroupProps {
  tools: ToolAction[];
  isStreaming?: boolean;
  streamingToolOutput?: string;
}

// ---------------------------------------------------------------------------
// Tool categorisation
// ---------------------------------------------------------------------------

type ToolCategory = 'read' | 'write' | 'bash' | 'search' | 'other';

function getToolCategory(name: string): ToolCategory {
  const lower = name.toLowerCase();
  if (lower === 'read' || lower === 'readfile' || lower === 'read_file') return 'read';
  if (
    lower === 'write' || lower === 'edit' || lower === 'writefile' ||
    lower === 'write_file' || lower === 'create_file' || lower === 'createfile' ||
    lower === 'notebookedit' || lower === 'notebook_edit'
  ) return 'write';
  if (
    lower === 'bash' || lower === 'exec' || lower === 'execute' || lower === 'run' ||
    lower === 'shell' || lower === 'execute_command' || lower === 'exec_command'
  ) return 'bash';
  if (
    lower === 'search' || lower === 'glob' || lower === 'grep' ||
    lower === 'find_files' || lower === 'search_files' ||
    lower === 'websearch' || lower === 'web_search'
  ) return 'search';
  return 'other';
}

function getToolIcon(category: ToolCategory): IconSvgElement {
  switch (category) {
    case 'read':   return File01Icon;
    case 'write':  return FileEditIcon;
    case 'bash':   return CommandLineIcon;
    case 'search': return Search01Icon;
    case 'other':  return Wrench01Icon;
  }
}

function getToolColor(category: ToolCategory): string {
  switch (category) {
    case 'read':   return 'text-[var(--tool-read)]';
    case 'write':  return 'text-[var(--tool-write)]';
    case 'bash':   return 'text-[var(--tool-bash)]';
    case 'search': return 'text-[var(--tool-search)]';
    case 'other':  return 'text-[var(--tool-other)]';
  }
}

// ---------------------------------------------------------------------------
// Summary helpers
// ---------------------------------------------------------------------------

function extractFilename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function getPatchText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  const payload = input as Record<string, unknown>;
  const raw = payload.patch || payload.diff || payload.content || '';
  return typeof raw === 'string' ? raw : '';
}

function extractPatchFilePaths(input: unknown): string[] {
  const patchText = getPatchText(input);
  if (!patchText) return [];
  const matches = patchText.matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to):\s+(.+)$/gm);
  const files = new Set<string>();
  for (const match of matches) {
    const filePath = match[1]?.trim();
    if (filePath) files.add(filePath);
  }
  return Array.from(files);
}

function buildFileListSummary(paths: string[]): string {
  if (paths.length === 0) return '';
  const first = extractFilename(paths[0]);
  if (paths.length === 1) return first;
  return `${first} +${paths.length - 1}`;
}

function getToolSummary(name: string, input: unknown, category: ToolCategory): string {
  const inp = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : undefined;
  const rawStringInput = typeof input === 'string' ? input.trim() : '';
  const normalizedName = name.trim().toLowerCase();

  if (normalizedName === 'apply_patch' || normalizedName === 'applypatch') {
    const patchFiles = extractPatchFilePaths(input);
    const patchSummary = buildFileListSummary(patchFiles);
    if (patchSummary) return patchSummary;
  }

  if (!inp && !rawStringInput) return name;

  switch (category) {
    case 'read':
    case 'write': {
      const path = (inp?.file_path || inp?.path || inp?.filePath || '') as string;
      return path ? extractFilename(path) : name;
    }
    case 'bash': {
      const cmd = rawStringInput || String(inp?.command || inp?.cmd || '');
      if (cmd) return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
      return name;
    }
    case 'search': {
      const pattern = (inp?.pattern || inp?.query || inp?.glob || '') as string;
      return pattern ? `"${pattern.length > 50 ? pattern.slice(0, 47) + '...' : pattern}"` : name;
    }
    default:
      return name;
  }
}

function getFilePath(input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return '';
  return (inp.file_path || inp.path || inp.filePath || '') as string;
}

function truncatePath(path: string, maxLen = 50): string {
  if (path.length <= maxLen) return path;
  return '...' + path.slice(path.length - maxLen + 3);
}

interface StructuredToolResultPayload {
  __noonflow_tool_result?: true;
  __monolith_tool_result?: true;
  output?: unknown;
}

function getRenderableToolResult(result?: string): string | undefined {
  if (!result) return result;
  try {
    const parsed = JSON.parse(result) as StructuredToolResultPayload;
    if (parsed && (parsed.__noonflow_tool_result === true || parsed.__monolith_tool_result === true)) {
      return typeof parsed.output === 'string' ? parsed.output : '';
    }
  } catch {
    // Non-JSON payload: render as-is.
  }
  return result;
}

// ---------------------------------------------------------------------------
// Status indicator — running: gray, completed: green, error: red
// ---------------------------------------------------------------------------

type ToolStatus = 'running' | 'success' | 'error';

function getStatus(tool: ToolAction): ToolStatus {
  if (tool.result === undefined) return 'running';
  return tool.isError ? 'error' : 'success';
}

function StatusDot({ status }: { status: ToolStatus }) {
  switch (status) {
    case 'running':
      return (
        <HugeiconsIcon icon={Loading02Icon} className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/50" />
      );
    case 'success':
      return <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />;
    case 'error':
      return <HugeiconsIcon icon={CancelCircleIcon} className="h-3.5 w-3.5 shrink-0 text-[var(--destructive)]" />;
  }
}

// ---------------------------------------------------------------------------
// Tool details view - shows expanded information for each tool type
// ---------------------------------------------------------------------------

function ToolDetailsView({ tool, category, filePath }: {
  tool: ToolAction;
  category: ToolCategory;
  filePath: string;
}) {
  const input = tool.input && typeof tool.input === 'object'
    ? tool.input as Record<string, unknown>
    : {};
  const result = getRenderableToolResult(tool.result);

  // For Write/Edit tools, show diff
  if (category === 'write' && filePath) {
    return (
      <FileDiffView
        filePath={filePath}
        toolName={tool.name}
        toolInput={tool.input}
      />
    );
  }

  // For Bash tools, show command and output
  if (category === 'bash') {
    const command = typeof tool.input === 'string'
      ? tool.input
      : String(input.command || input.cmd || '');
    return (
      <div className="rounded-md border border-border bg-background overflow-hidden">
        <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
          Command
        </div>
        <div className="p-3 space-y-2">
          <div className="font-mono text-xs bg-muted/30 rounded px-2 py-1.5">
            {command}
          </div>
          {result && (
            <>
              <div className="text-xs font-medium text-muted-foreground">Output:</div>
              <div className="font-mono text-xs bg-muted/30 rounded px-2 py-1.5 max-h-[300px] overflow-auto whitespace-pre-wrap">
                {result}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // For Read tools, show file content
  if (category === 'read' && filePath) {
    return (
      <div className="rounded-md border border-border bg-background overflow-hidden">
        <button
          type="button"
          onClick={() => publishOpenFilePreview({ path: filePath })}
          className="w-full bg-muted/50 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground border-b border-border hover:text-foreground"
          title={filePath}
        >
          {filePath}
        </button>
        {result && (
          <div className="font-mono text-xs bg-muted/30 p-3 max-h-[400px] overflow-auto whitespace-pre-wrap">
            {result}
          </div>
        )}
      </div>
    );
  }

  // For Search tools (Grep, Glob), show results
  if (category === 'search') {
    const pattern = String(input.pattern || input.query || input.glob || '');
    return (
      <div className="rounded-md border border-border bg-background overflow-hidden">
        <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
          Pattern: {pattern}
        </div>
        {result && (
          <div className="font-mono text-xs bg-muted/30 p-3 max-h-[400px] overflow-auto whitespace-pre-wrap">
            {result}
          </div>
        )}
      </div>
    );
  }

  // For other tools, show generic input/output
  return (
    <div className="rounded-md border border-border bg-background overflow-hidden">
      <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
        {tool.name}
      </div>
      <div className="p-3 space-y-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Input:</div>
          <div className="font-mono text-xs bg-muted/30 rounded px-2 py-1.5 max-h-[200px] overflow-auto">
            {JSON.stringify(input, null, 2)}
          </div>
        </div>
        {result && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Output:</div>
            <div className="font-mono text-xs bg-muted/30 rounded px-2 py-1.5 max-h-[200px] overflow-auto whitespace-pre-wrap">
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact row for a single tool action
// ---------------------------------------------------------------------------

function ToolActionRow({ tool }: { tool: ToolAction }) {
  const [showDetails, setShowDetails] = useState(false);
  const category = getToolCategory(tool.name);
  const icon = getToolIcon(category);
  const iconColor = getToolColor(category);
  const summary = getToolSummary(tool.name, tool.input, category);
  const filePath = getFilePath(tool.input);
  const status = getStatus(tool);

  const label = category === 'bash' ? '' : tool.name;
  // Allow both successful and failed executions to open details.
  // Only running items remain non-expandable.
  const canExpand = status !== 'running';

  const handleClick = () => {
    if (canExpand) {
      setShowDetails(!showDetails);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-2.5 px-2 py-1.5 min-h-[28px] text-[13px] rounded-md transition-all ${
          canExpand ? 'hover:bg-foreground/5 cursor-pointer' : 'hover:bg-foreground/5'
        }`}
        onClick={handleClick}
      >
        <HugeiconsIcon icon={icon} className={`h-4 w-4 shrink-0 ${iconColor}`} />

        {label && (
          <span className="font-medium text-foreground/80 shrink-0">{label}</span>
        )}

        <span className="font-mono text-muted-foreground/70 truncate flex-1 text-xs">
          {summary}
        </span>

        {filePath && (category === 'read' || category === 'write') && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              publishOpenFilePreview({ path: filePath });
            }}
            className="text-muted-foreground/40 text-[11px] font-mono truncate max-w-[200px] hidden sm:inline hover:text-muted-foreground"
            title={filePath}
          >
            {truncatePath(filePath)}
          </button>
        )}

        <StatusDot status={status} />
      </div>

      {/* Details view for all tools */}
      {showDetails && canExpand && (
        <div className="mt-1.5 mb-3 ml-7">
          <ToolDetailsView
            tool={tool}
            category={category}
            filePath={filePath}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header summary helper — build running task description
// ---------------------------------------------------------------------------

function getRunningDescription(tools: ToolAction[]): string {
  const running = tools.filter((t) => t.result === undefined);
  if (running.length === 0) return '';
  const last = running[running.length - 1];
  const category = getToolCategory(last.name);
  return getToolSummary(last.name, last.input, category);
}

// ---------------------------------------------------------------------------
// Main group component
// ---------------------------------------------------------------------------

export function ToolActionsGroup({
  tools,
  isStreaming = false,
  streamingToolOutput,
}: ToolActionsGroupProps) {
  const hasRunningTool = tools.some((t) => t.result === undefined);
  const liveOutput = (streamingToolOutput || '').trim();
  const showLiveOutput = isStreaming && hasRunningTool && liveOutput.length > 0;

  // Track whether user has manually toggled and their chosen state
  const [userExpandedState, setUserExpandedState] = useState<boolean | null>(null);

  // Derived: if user has toggled, use their choice; otherwise auto-expand based on streaming state
  const expanded = userExpandedState !== null ? userExpandedState : (hasRunningTool || isStreaming);

  if (tools.length === 0) return null;

  // Single tool simplification - keep streaming and completed states visually consistent.
  if (tools.length === 1) {
    return (
      <div className="w-[min(100%,48rem)]">
        <ToolActionRow tool={tools[0]} />
        {showLiveOutput && (
          <div className="ml-7 mt-2 rounded-md border border-border bg-background overflow-hidden">
            <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
              Live output
            </div>
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs text-foreground/90">
              {liveOutput}
            </pre>
          </div>
        )}
      </div>
    );
  }

  const runningCount = tools.filter((t) => t.result === undefined).length;
  const doneCount = tools.length - runningCount;
  const runningDesc = getRunningDescription(tools);

  const handleToggle = () => {
    setUserExpandedState((prev) => prev !== null ? !prev : !expanded);
  };

  // Build summary text parts
  const summaryParts: string[] = [];
  if (runningCount > 0) summaryParts.push(`${runningCount} running`);
  if (doneCount > 0) summaryParts.push(`${doneCount} completed`);
  if (summaryParts.length === 0) summaryParts.push(`${tools.length} actions`);

  return (
    <div className="w-[min(100%,48rem)]">
      {/* Header — minimal: chevron + count + gray summary */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-2 py-1.5 text-xs rounded-sm hover:opacity-80 transition-opacity w-fit"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />

        <span className="text-muted-foreground font-medium">
          {summaryParts.join(' · ')}
        </span>

        {/* Show running task description on the right */}
        {runningDesc && (
          <span className="ml-2 text-muted-foreground/60 text-[11px] font-mono truncate max-w-[40%]">
            {runningDesc}
          </span>
        )}
      </button>

      {/* Expanded list — left vertical line like blockquote */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{ overflow: 'hidden', transformOrigin: 'top' }}
          >
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
            >
              <div className="ml-[5px] mt-1 border-l border-border/40 pl-3 space-y-0.5">
                {tools.map((tool, i) => (
                  <ToolActionRow key={tool.id || `tool-${i}`} tool={tool} />
                ))}
                {showLiveOutput && (
                  <div className="mt-2 rounded-md border border-border bg-background overflow-hidden">
                    <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">
                      Live output
                    </div>
                    <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs text-foreground/90">
                      {liveOutput}
                    </pre>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
