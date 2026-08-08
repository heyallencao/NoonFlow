"use client";

import type { HTMLAttributes, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder01Icon,
  FolderOpenIcon,
  File01Icon,
  ArrowRight01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string) => void;
}

// Default noop for context default value
// oxlint-disable-next-line eslint(no-empty-function)
const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  // oxlint-disable-next-line eslint-plugin-unicorn(no-new-builtin)
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = new Set(),
  selectedPath,
  onSelect,
  onAdd,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      setInternalExpanded(newExpanded);
      onExpandedChange?.(newExpanded);
    },
    [expandedPaths, onExpandedChange]
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onAdd, onSelect, selectedPath, togglePath }),
    [expandedPaths, onAdd, onSelect, selectedPath, togglePath]
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn(
          "rounded-lg bg-transparent font-mono text-sm",
          className
        )}
        role="tree"
        {...props}
      >
        <div className="p-2">{children}</div>
      </div>
    </FileTreeContext.Provider>
  );
};

interface FileTreeFolderContextType {
  path: string;
  name: string;
  isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
  isExpanded: false,
  name: "",
  path: "",
});

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  actions?: ReactNode;
};

export const FileTreeFolder = ({
  path,
  name,
  actions,
  className,
  children,
  ...props
}: FileTreeFolderProps) => {
  const { expandedPaths, togglePath } =
    useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);

  const handleToggle = useCallback(() => {
    togglePath(path);
  }, [togglePath, path]);
  const handleRowClick = useCallback(() => {
    togglePath(path);
  }, [togglePath, path]);
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    togglePath(path);
  }, [togglePath, path]);

  const folderContextValue = useMemo(
    () => ({ isExpanded, name, path }),
    [isExpanded, name, path]
  );

  return (
    <FileTreeFolderContext.Provider value={folderContextValue}>
      <Collapsible onOpenChange={handleToggle} open={isExpanded}>
        <div
          className={cn("", className)}
          role="treeitem"
          aria-selected={false}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          {...props}
        >
          <div
            className="group/folder flex min-w-full w-max cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 text-left transition-[background-color,color,box-shadow] hover:bg-white/5 hover:text-foreground focus-within:bg-white/5 focus-within:text-foreground"
            onClick={handleRowClick}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 transition-colors hover:bg-foreground/5"
                onClick={(e) => e.stopPropagation()}
              >
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className={cn(
                    "size-4 text-muted-foreground transition-transform group-hover/folder:text-foreground/85 group-focus-within/folder:text-foreground/85",
                    isExpanded && "rotate-90"
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <FileTreeIcon>
              {isExpanded ? (
                <HugeiconsIcon icon={FolderOpenIcon} className="size-4 text-amber-500/70 transition-colors group-hover/folder:text-amber-500 group-focus-within/folder:text-amber-500" />
              ) : (
                <HugeiconsIcon icon={Folder01Icon} className="size-4 text-amber-500/70 transition-colors group-hover/folder:text-amber-500 group-focus-within/folder:text-amber-500" />
              )}
            </FileTreeIcon>
            <FileTreeName className="pr-2">{name}</FileTreeName>
            {actions && (
              <FileTreeActions className="opacity-0 transition-opacity group-hover/folder:opacity-100">
                {actions}
              </FileTreeActions>
            )}
          </div>
          <CollapsibleContent>
            <div className="ml-4 pl-3">{children}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </FileTreeFolderContext.Provider>
  );
};

interface FileTreeFileContextType {
  path: string;
  name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
  name: "",
  path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  icon?: ReactNode;
  actions?: ReactNode;
};

export const FileTreeFile = ({
  path,
  name,
  icon,
  actions,
  className,
  children,
  ...props
}: FileTreeFileProps) => {
  const { selectedPath, onSelect, onAdd } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;

  const handleClick = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        onSelect?.(path);
      }
    },
    [onSelect, path]
  );

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onAdd?.(path);
    },
    [onAdd, path]
  );

  const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

  return (
    <FileTreeFileContext.Provider value={fileContextValue}>
      <div
        className={cn(
          "group/file flex min-w-full w-max cursor-pointer items-center gap-1 rounded-md px-2 py-1 transition-[background-color,color,box-shadow] hover:bg-white/5 hover:text-foreground focus-visible:bg-white/5 focus-visible:text-foreground",
          isSelected && "bg-white/10 text-foreground shadow-sm font-medium",
          className
        )}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        aria-selected={isSelected}
        tabIndex={0}
        {...props}
      >
        {children ?? (
          <>
            <FileTreeIcon>
              {icon ?? <HugeiconsIcon icon={File01Icon} className="size-4 text-blue-400/60 transition-colors group-hover/file:text-blue-400/80 group-focus-visible/file:text-blue-400/80" />}
            </FileTreeIcon>
            <FileTreeName className="pr-2">{name}</FileTreeName>
            {(onAdd || actions) && (
              <FileTreeActions className="opacity-0 transition-opacity group-hover/file:opacity-100">
                {onAdd && (
                  <button
                    type="button"
                    className="flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-foreground/5"
                    onClick={handleAdd}
                    title="Add to chat"
                  >
                    <HugeiconsIcon icon={PlusSignIcon} className="size-3 text-muted-foreground transition-colors group-hover/file:text-foreground/85" />
                  </button>
                )}
                {actions}
              </FileTreeActions>
            )}
          </>
        )}
      </div>
    </FileTreeFileContext.Provider>
  );
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
  className,
  children,
  ...props
}: FileTreeIconProps) => (
  <span className={cn("shrink-0", className)} {...props}>
    {children}
  </span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
  className,
  children,
  ...props
}: FileTreeNameProps) => (
  <span className={cn("whitespace-nowrap", className)} {...props}>
    {children}
  </span>
);

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const FileTreeActions = ({
  className,
  children,
  ...props
}: FileTreeActionsProps) => (
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stopPropagation required for nested interactions
  // biome-ignore lint/a11y/useSemanticElements: fieldset doesn't fit this UI pattern
  <div
    className={cn("ml-auto flex items-center gap-1", className)}
    onClick={stopPropagation}
    onKeyDown={stopPropagation}
    role="group"
    {...props}
  >
    {children}
  </div>
);
