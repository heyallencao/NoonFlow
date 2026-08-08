"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Folder01Icon,
  FolderOpenIcon,
  GlobeIcon,
  Search01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { getSkillItemKey } from "./SkillListItem";
import type { SkillItem } from "./SkillListItem";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

interface SearchSkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (skill: SkillItem) => void;
  skills: SkillItem[];
}

const sourceMeta = {
  global: { icon: ZapIcon, label: "Global", iconClassName: "text-blue-500" },
  installed: { icon: FolderOpenIcon, label: "Installed", iconClassName: "text-orange-400" },
  plugin: { icon: GlobeIcon, label: "Plugin", iconClassName: "text-indigo-400" },
  project: { icon: Folder01Icon, label: "Project", iconClassName: "text-blue-400" },
} as const;

export function SearchSkillsDialog({
  open,
  onOpenChange,
  onSelect,
  skills,
}: SearchSkillsDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSearch("");
    }
    onOpenChange(nextOpen);
  };

  const filteredSkills = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return skills;
    }

    return skills.filter((skill) =>
      [skill.name, skill.description, skill.filePath, skill.installedSource]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [search, skills]);

  const handleSelect = (skill: SkillItem) => {
    onSelect(skill);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl gap-0 overflow-hidden rounded-2xl border-border-default bg-bg-secondary p-0 shadow-2xl">
        <DialogHeader className="border-b border-border-subtle p-4 pb-3">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-info/10 text-info">
              <HugeiconsIcon icon={Search01Icon} className="h-4 w-4" />
            </div>
            {t("skills.searchSkills")}
          </DialogTitle>
        </DialogHeader>

        <div className="border-b border-border-subtle px-4 py-4 bg-bg-secondary">
          <div className="relative flex items-center rounded-xl border border-border-subtle bg-bg-primary px-3 py-2.5 focus-within:ring-1 focus-within:ring-info/40 transition-all">
            <HugeiconsIcon icon={Search01Icon} className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("skills.searchSkills")}
              className="flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/30"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="ml-2 shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground"
                aria-label="Clear search"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[420px] overflow-y-auto bg-bg-primary custom-scrollbar">
          {skills.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground/50 font-medium">
              <HugeiconsIcon icon={ZapIcon} className="mx-auto mb-3 h-8 w-8 opacity-10" />
              {t("skills.noSkillsFound")}
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground/50 font-medium">
              <HugeiconsIcon icon={Search01Icon} className="mx-auto mb-3 h-8 w-8 opacity-10" />
              {t("skills.searchNoResults")}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border-subtle/30">
              {filteredSkills.map((skill) => {
                const meta = sourceMeta[skill.source];

                return (
                  <button
                    key={getSkillItemKey(skill)}
                    type="button"
                    onClick={() => handleSelect(skill)}
                    className="flex items-center justify-between gap-4 px-4 py-3.5 text-left transition-all hover:bg-bg-hover group"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                        skill.source === "global" ? "bg-primary/10 text-primary" :
                        skill.source === "installed" ? "bg-warning/10 text-warning" :
                        skill.source === "plugin" ? "bg-info/10 text-info" :
                        "bg-muted/10 text-muted-foreground"
                      )}>
                        <HugeiconsIcon icon={meta.icon} className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-bold text-foreground group-hover:text-primary transition-colors">{skill.name}</div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60 leading-normal">
                          {skill.description || skill.filePath}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="rounded-md bg-muted/10 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-tight">
                        {meta.label}
                      </span>
                      <HugeiconsIcon icon={ArrowRight01Icon} className="h-4 w-4 text-muted-foreground/20 group-hover:text-primary transition-colors" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle bg-bg-secondary px-4 py-3 text-[11px] font-medium text-muted-foreground/40">
          <span>{filteredSkills.length} skills total</span>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => handleOpenChange(false)} 
            className="h-7 px-3 rounded-lg hover:bg-bg-hover text-muted-foreground hover:text-foreground font-bold"
          >
            {t("common.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
