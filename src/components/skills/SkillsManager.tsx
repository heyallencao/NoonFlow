"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePanel } from "@/hooks/usePanel";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder01Icon,
  GlobeIcon,
  Loading02Icon,
  PlusSignIcon,
  ZapIcon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import { Info } from "lucide-react";
import { SkillListItem, getSkillItemKey, isSameSkillItem } from "./SkillListItem";
import { SkillEditor } from "./SkillEditor";
import { CreateSkillDialog } from "./CreateSkillDialog";
import { SearchSkillsDialog } from "./SearchSkillsDialog";
import { useTranslation } from "@/hooks/useTranslation";
import { BrowseSkillsDialog } from "./BrowseSkillsDialog";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { InstallProgressDialog } from "./InstallProgressDialog";
import type { SkillItem } from "./SkillListItem";
import { cn } from "@/lib/utils";
import { AutomationHeader } from "@/components/automation/AutomationHeader";
import { AutomationToolbar, RuntimeFilter } from "@/components/automation/AutomationToolbar";
import { toast } from "sonner";

export function SkillsManager() {
  const { workingDirectory } = usePanel();
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [selected, setSelected] = useState<SkillItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const { openNativePicker } = useNativeFolderPicker();
  const [installingFolder, setInstallingFolder] = useState<{ path: string; name: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillItem | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "global" | "installed" | "plugin">("all");

  const fetchSkills = useCallback(async () => {
    try {
      const cwdParam = workingDirectory ? `?cwd=${encodeURIComponent(workingDirectory)}` : "";
      const res = await fetch(`/api/skills${cwdParam}`);
      if (res.ok) {
        const data = await res.json();
        setSkills((data.skills || []).filter((skill: SkillItem) => skill.source !== "project"));
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [workingDirectory]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleCreate = useCallback(
    async (name: string, scope: "global" | "project", content: string) => {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content, scope, cwd: workingDirectory || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create skill");
      }
      const data = await res.json();
      setSkills((prev) => [...prev, data.skill]);
      setSelected(data.skill);
    },
    [workingDirectory]
  );

  const buildSkillUrl = useCallback(
    (skill: SkillItem) => {
      const params = new URLSearchParams();
      if (skill.source === "installed" && skill.installedSource) {
        params.set("source", skill.installedSource);
      }
      if (workingDirectory) {
        params.set("cwd", workingDirectory);
      }
      const qs = params.toString();
      return `/api/skills/${encodeURIComponent(skill.name)}${qs ? `?${qs}` : ""}`;
    },
    [workingDirectory]
  );

  const handleSave = useCallback(
    async (skill: SkillItem, content: string) => {
      const res = await fetch(buildSkillUrl(skill), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save skill");
      }
      const data = await res.json();
      setSkills((prev) =>
        prev.map((currentSkill) =>
          isSameSkillItem(currentSkill, skill) ? data.skill : currentSkill
        )
      );
      setSelected(data.skill);
    },
    [buildSkillUrl]
  );

  const performDelete = useCallback(
    async (skill: SkillItem) => {
      const res = await fetch(buildSkillUrl(skill), { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        toast.error(data?.error || "Failed to delete skill");
        return;
      }

      setSkills((prev) =>
        prev.filter(
          (currentSkill) =>
            !isSameSkillItem(currentSkill, skill)
        )
      );

      if (
        selected && isSameSkillItem(selected, skill)
      ) {
        setSelected(null);
      }
    },
    [buildSkillUrl, selected]
  );

  const handleDelete = useCallback((skill: SkillItem) => {
    if (skill.source === "installed") {
      setPendingDelete(skill);
      return;
    }
    void performDelete(skill);
  }, [performDelete]);

  const filteredSkills = useMemo(() => {
    return skills.filter(skill => {
      if (searchQuery && !skill.name.toLowerCase().includes(searchQuery.toLowerCase()) && !skill.description?.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      const runtimeAvailability = skill.runtimeAvailability
        ?? (
          skill.source === "global"
            ? ["claude"]
            : skill.source === "plugin"
              ? ["codex"]
              : skill.source === "installed"
                ? [skill.installedSource === "agents" ? "codex" : "claude"]
                : []
        );

      const isClaudeCode = runtimeAvailability.includes("claude");
      const isCodex = runtimeAvailability.includes("codex");
      
      if (runtimeFilter === "claude" && !isClaudeCode) return false;
      if (runtimeFilter === "codex" && !isCodex) return false;

      if (sourceFilter !== "all" && skill.source !== sourceFilter) return false;

      return true;
    });
  }, [skills, searchQuery, runtimeFilter, sourceFilter]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <HugeiconsIcon icon={Loading02Icon} className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground font-medium">{t("skills.loadingSkills")}</span>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col bg-background">
        <SkillEditor
          skill={selected}
          onSave={handleSave}
          onDelete={handleDelete}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  const extraFilters = (
    <div className="flex items-center">
      {(["all", "global", "installed", "plugin"] as const).map(src => (
        <button
          key={src}
          onClick={() => setSourceFilter(src)}
          className={cn(
            "px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all duration-200",
            sourceFilter === src ? "bg-bg-hover text-foreground shadow-sm" : "text-muted-foreground/70 hover:text-foreground hover:bg-bg-hover/50"
          )}
        >
          {src}
        </button>
      ))}
    </div>
  );

  const globalSkills = filteredSkills.filter((skill) => skill.source === "global");
  const installedSkills = filteredSkills.filter((skill) => skill.source === "installed");
  const pluginSkills = filteredSkills.filter((skill) => skill.source === "plugin");

  return (
    <div className="flex h-full flex-col bg-background text-foreground overflow-hidden">
      <AutomationHeader 
        title={t("extensions.skills") || "Skills"}
        description="Define and manage reusable automation skills across runtimes."
        action={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const folderPath = await openNativePicker({ title: "Select Skill Folder" });
                if (!folderPath) return;
                const parts = folderPath.split(/[\\/]/);
                setInstallingFolder({ path: folderPath, name: parts[parts.length - 1] });
              }}
              className="h-9 rounded-lg text-[12px] font-bold bg-bg-secondary hover:bg-bg-hover transition-colors shadow-sm border-border-subtle"
            >
              <HugeiconsIcon icon={Folder01Icon} className="mr-1.5 h-4 w-4 text-muted-foreground" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowBrowse(true)}
              className="h-9 rounded-lg text-[12px] font-bold bg-bg-secondary hover:bg-bg-hover transition-colors shadow-sm border-border-subtle"
            >
              <HugeiconsIcon icon={GlobeIcon} className="mr-1.5 h-4 w-4 text-muted-foreground" />
              Marketplace
            </Button>
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="h-9 rounded-lg text-[12px] font-bold shadow-md hover:shadow-lg transition-all"
            >
              <HugeiconsIcon icon={PlusSignIcon} className="mr-1.5 h-4 w-4" />
              {t("skills.newSkill")}
            </Button>
          </>
        }
      />

      <AutomationToolbar 
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        runtimeFilter={runtimeFilter}
        onRuntimeFilterChange={setRuntimeFilter}
        extraFilters={extraFilters}
      />

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center w-full h-full">
            <HugeiconsIcon icon={ZapIcon} className="h-12 w-12 text-muted-foreground/20 mb-4" />
            <p className="text-[14px] font-bold text-foreground">No skills found</p>
            <p className="text-[12px] text-muted-foreground mt-1 max-w-xs">
              Try changing your filters or create a new skill to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-10 pb-12">
            {globalSkills.length > 0 && (
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <HugeiconsIcon icon={ZapIcon} className="h-4 w-4" />
                  </div>
                  <h2 className="text-[15px] font-bold text-foreground">Global</h2>
                  <span className="text-xs text-muted-foreground/60 bg-muted/20 px-1.5 py-0.5 rounded-md">{globalSkills.length}</span>
                  <Info className="ml-1 h-3.5 w-3.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-help" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                  {globalSkills.map((skill) => (
                    <div key={getSkillItemKey(skill)}>
                      <SkillListItem
                        skill={skill}
                        selected={false}
                        onSelect={() => setSelected(skill)}
                        onDelete={handleDelete}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {installedSkills.length > 0 && (
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--warning)]/10 text-[var(--warning)]">
                    <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
                  </div>
                  <h2 className="text-[15px] font-bold text-foreground">Installed</h2>
                  <span className="text-xs text-muted-foreground/60 bg-muted/20 px-1.5 py-0.5 rounded-md">{installedSkills.length}</span>
                  <Info className="ml-1 h-3.5 w-3.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-help" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                  {installedSkills.map((skill) => (
                    <div key={getSkillItemKey(skill)}>
                      <SkillListItem
                        skill={skill}
                        selected={false}
                        onSelect={() => setSelected(skill)}
                        onDelete={handleDelete}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pluginSkills.length > 0 && (
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--info)]/10 text-[var(--info)]">
                    <HugeiconsIcon icon={GlobeIcon} className="h-4 w-4" />
                  </div>
                  <h2 className="text-[15px] font-bold text-foreground">Plugins</h2>
                  <span className="text-xs text-muted-foreground/60 bg-muted/20 px-1.5 py-0.5 rounded-md">{pluginSkills.length}</span>
                  <Info className="ml-1 h-3.5 w-3.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-help" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                  {pluginSkills.map((skill) => (
                    <div key={getSkillItemKey(skill)}>
                      <SkillListItem
                        skill={skill}
                        selected={false}
                        onSelect={() => setSelected(skill)}
                        onDelete={handleDelete}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <CreateSkillDialog open={showCreate} onOpenChange={setShowCreate} onCreate={handleCreate} />
      <SearchSkillsDialog
        open={showSearch}
        onOpenChange={setShowSearch}
        skills={skills}
        onSelect={(skill) => setSelected(skill)}
      />
      <BrowseSkillsDialog open={showBrowse} onOpenChange={setShowBrowse} onInstalled={fetchSkills} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="border-border-default bg-bg-secondary text-sidebar-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('skills.uninstallConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-muted-foreground">
                <p>{t('skills.uninstallConfirmDesc', { name: pendingDelete?.name || "" })}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                const skill = pendingDelete;
                setPendingDelete(null);
                if (skill) {
                  void performDelete(skill);
                }
              }}
            >
              {t('skills.uninstall')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {installingFolder ? (
        <InstallProgressDialog
          open={!!installingFolder}
          onOpenChange={(open) => !open && setInstallingFolder(null)}
          action="install"
          source={installingFolder.path}
          skillName={installingFolder.name}
          onComplete={() => {
            fetchSkills();
            setInstallingFolder(null);
          }}
        />
      ) : null}
    </div>
  );
}
