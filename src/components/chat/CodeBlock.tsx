'use client';

import { useState, useMemo, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter';
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Tick01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from '@/lib/utils';

const COLLAPSE_THRESHOLD = 20;
const VISIBLE_LINES = 10;

const TERMINAL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'terminal', 'zsh', 'console']);

// Enhanced oneDark theme with better contrast - using bright white for main text
const enhancedOneDark: SyntaxHighlighterProps['style'] = {
  ...oneDark,
  // Base styles - bright white for all default text
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    color: '#f0f0f0', // Bright white for main text
  },
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    color: '#f0f0f0',
  },
  'comment': {
    ...oneDark['comment'],
    color: '#8a8a8a', // Lighter gray for comments
  },
  'prolog': {
    ...oneDark['prolog'],
    color: '#8a8a8a',
  },
  'doctype': {
    ...oneDark['doctype'],
    color: '#8a8a8a',
  },
  'cdata': {
    ...oneDark['cdata'],
    color: '#8a8a8a',
  },
  'punctuation': {
    ...oneDark['punctuation'],
    color: '#f0f0f0', // Bright white for punctuation
  },
  'property': {
    ...oneDark['property'],
    color: '#e5c07b', // Keep yellow, good contrast
  },
  'tag': {
    ...oneDark['tag'],
    color: '#e06c75', // Keep red, good contrast
  },
  'boolean': {
    ...oneDark['boolean'],
    color: '#d19a66', // Keep orange, good contrast
  },
  'number': {
    ...oneDark['number'],
    color: '#d19a66',
  },
  'constant': {
    ...oneDark['constant'],
    color: '#d19a66',
  },
  'symbol': {
    ...oneDark['symbol'],
    color: '#61afef', // Keep blue, good contrast
  },
  'selector': {
    ...oneDark['selector'],
    color: '#e06c75',
  },
  'attr-name': {
    ...oneDark['attr-name'],
    color: '#d19a66',
  },
  'string': {
    ...oneDark['string'],
    color: '#98c379', // Keep green, good contrast
  },
  'char': {
    ...oneDark['char'],
    color: '#98c379',
  },
  'builtin': {
    ...oneDark['builtin'],
    color: '#e5c07b',
  },
  'inserted': {
    ...oneDark['inserted'],
    color: '#98c379',
  },
  'operator': {
    ...oneDark['operator'],
    color: '#f0f0f0', // Bright white for operators
  },
  'entity': {
    ...oneDark['entity'],
    color: '#d19a66',
  },
  'url': {
    ...oneDark['url'],
    color: '#61afef',
  },
  'variable': {
    ...oneDark['variable'],
    color: '#f0f0f0', // Bright white for variables
  },
  'atrule': {
    ...oneDark['atrule'],
    color: '#c678dd',
  },
  'attr-value': {
    ...oneDark['attr-value'],
    color: '#98c379',
  },
  'function': {
    ...oneDark['function'],
    color: '#61afef',
  },
  'class-name': {
    ...oneDark['class-name'],
    color: '#e5c07b',
  },
  'keyword': {
    ...oneDark['keyword'],
    color: '#c678dd',
  },
  'regex': {
    ...oneDark['regex'],
    color: '#98c379',
  },
  'important': {
    ...oneDark['important'],
    color: '#e06c75',
    fontWeight: 'bold',
  },
  'deleted': {
    ...oneDark['deleted'],
    color: '#e06c75',
  },
  // Additional token types for better coverage
  'plain': {
    color: '#f0f0f0',
  },
  'parameter': {
    color: '#f0f0f0',
  },
  'maybe-class-name': {
    color: '#e5c07b',
  },
};

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  maxCollapsedLines?: number;
}

export function CodeBlock({
  code,
  language = 'text',
  showLineNumbers = true,
  maxCollapsedLines = VISIBLE_LINES,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const [animatingHeight, setAnimatingHeight] = useState<string | undefined>(undefined);

  const lines = useMemo(() => code.split('\n'), [code]);
  const totalLines = lines.length;
  const isCollapsible = totalLines > COLLAPSE_THRESHOLD;
  const isTerminal = TERMINAL_LANGUAGES.has(language.toLowerCase());

  const displayCode = useMemo(() => {
    if (!isCollapsible || expanded) return code;
    return lines.slice(0, maxCollapsedLines).join('\n');
  }, [code, lines, isCollapsible, expanded, maxCollapsedLines]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const handleToggleExpand = () => {
    const container = codeContainerRef.current;
    if (!container) {
      setExpanded(!expanded);
      return;
    }
    const currentHeight = container.scrollHeight;
    if (!expanded) {
      // Expanding: set current height, then switch to auto after transition
      setAnimatingHeight(`${currentHeight}px`);
      setExpanded(true);
      requestAnimationFrame(() => {
        // Measure the full height after content change
        const fullHeight = container.scrollHeight;
        setAnimatingHeight(`${fullHeight}px`);
        setTimeout(() => setAnimatingHeight(undefined), 300);
      });
    } else {
      // Collapsing: set current height, then reduce
      setAnimatingHeight(`${currentHeight}px`);
      requestAnimationFrame(() => {
        const collapsedH = maxCollapsedLines * 1.5 + 1.5;
        setAnimatingHeight(`${collapsedH}rem`);
        setTimeout(() => {
          setExpanded(false);
          setAnimatingHeight(undefined);
        }, 300);
      });
    }
  };

  const theme = isTerminal ? vscDarkPlus : enhancedOneDark;

  return (
    <div className="relative group not-prose my-4 rounded-xl overflow-hidden border border-transparent bg-foreground/[0.03]">
      {/* Copy button overlay */}
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-2 opacity-0 group-hover:opacity-100 flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground/60 hover:text-foreground bg-background/80 hover:bg-background backdrop-blur-sm transition-all shadow-sm border border-foreground/10"
        title="Copy code"
      >
        {copied ? (
          <>
            <HugeiconsIcon icon={Tick01Icon} className="h-3 w-3" />
            <span className="text-xs">Copied</span>
          </>
        ) : (
          <>
            <HugeiconsIcon icon={Copy01Icon} className="h-3 w-3" />
            <span className="text-xs">Copy</span>
          </>
        )}
      </button>

      {/* Code area */}
      <div
        ref={codeContainerRef}
        className="relative transition-[max-height] duration-300 ease-in-out overflow-hidden"
        style={{
          maxHeight: animatingHeight ?? (!isCollapsible || expanded ? undefined : `${maxCollapsedLines * 1.5 + 1.5}rem`),
        }}
      >
        <SyntaxHighlighter
          style={theme}
          language={language}
          PreTag="div"
          showLineNumbers={showLineNumbers && !isTerminal}
          lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '1em',
            color: '#3a3a48',
            userSelect: 'none',
          }}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: '0.8125rem',
            lineHeight: '1.5',
            padding: isTerminal ? '0.75rem 1rem' : '0.75rem 0.5rem',
            background: isTerminal ? '#0a0a0a' : undefined,
            overflow: 'auto',
          }}
          wrapLines
        >
          {expanded ? code : displayCode}
        </SyntaxHighlighter>

        {/* Gradient overlay for collapsed state */}
        {isCollapsible && !expanded && (
          <div className={cn(
            "absolute bottom-0 left-0 right-0 h-12 pointer-events-none",
            isTerminal
              ? "bg-gradient-to-t from-[#0a0a0a] to-transparent"
              : "bg-gradient-to-t from-background to-transparent"
          )} />
        )}
      </div>

      {/* Expand/Collapse button */}
      {isCollapsible && (
        <button
          onClick={handleToggleExpand}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors border-t border-foreground/5",
            isTerminal
              ? "bg-zinc-950/50 text-zinc-400 hover:text-zinc-200"
              : "bg-foreground/[0.02] text-muted-foreground/60 hover:text-foreground hover:bg-foreground/5"
          )}
        >
          {expanded ? (
            <>
              <HugeiconsIcon icon={ArrowUp01Icon} className="h-3 w-3" />
              <span>收起完整代码</span>
            </>
          ) : (
            <>
              <HugeiconsIcon icon={ArrowDown01Icon} className="h-3 w-3" />
              <span>展开全部 {totalLines} 行代码</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

// Inline code component for reuse
export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
      {children}
    </code>
  );
}
