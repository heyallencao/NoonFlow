"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CodeMirrorSourceEditor } from "@/components/layout/CodeMirrorSourceEditor";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import type { ApiProvider } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";

const PROVIDER_PRESETS: Record<string, { base_url: string; extra_env: string }> = {
  anthropic: { base_url: "https://api.anthropic.com", extra_env: "{}" },
  openrouter: { base_url: "https://openrouter.ai/api", extra_env: '{"ANTHROPIC_API_KEY":""}' },
  bedrock: { base_url: "", extra_env: '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1","CLAUDE_CODE_SKIP_BEDROCK_AUTH":"1"}' },
  vertex: { base_url: "", extra_env: '{"CLAUDE_CODE_USE_VERTEX":"1","CLOUD_ML_REGION":"us-east5","CLAUDE_CODE_SKIP_VERTEX_AUTH":"1"}' },
  custom: { base_url: "", extra_env: "{}" },
};

const PROVIDER_TYPES = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "vertex", label: "Google Vertex" },
  { value: "custom", label: "Custom" },
];

interface ProviderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  provider?: ApiProvider | null;
  onSave: (data: ProviderFormData) => Promise<void>;
  initialPreset?: { name: string; provider_type: string; base_url: string; extra_env?: string } | null;
}

export interface ProviderFormData {
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  extra_env: string;
  notes: string;
}

export function ProviderForm({
  open,
  onOpenChange,
  mode,
  provider,
  onSave,
  initialPreset,
}: ProviderFormProps) {
  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [extraEnv, setExtraEnv] = useState("{}");
  const [modelNames, setModelNames] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState("");
  const [notes, setNotes] = useState("");
  const [extraEnvVersion, setExtraEnvVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  /** Extract model list from extra_env JSON */
  const parseModelsFromEnv = useCallback((envStr: string): string[] => {
    try {
      const parsed = JSON.parse(envStr || "{}") as Record<string, unknown>;
      const models: string[] = [];
      if (typeof parsed.ANTHROPIC_MODEL === "string" && parsed.ANTHROPIC_MODEL.trim()) {
        models.push(parsed.ANTHROPIC_MODEL.trim());
      }
      const listVal = parsed.NOONFLOW_PROVIDER_MODELS ?? parsed.MONOLITH_PROVIDER_MODELS;
      if (typeof listVal === "string" && listVal.trim()) {
        for (const m of listVal.split(",").map((s: string) => s.trim()).filter(Boolean)) {
          if (!models.includes(m)) models.push(m);
        }
      }
      return models;
    } catch {
      return [];
    }
  }, []);

  const handleAddModel = useCallback(() => {
    const trimmed = modelInput.trim();
    if (trimmed && !modelNames.includes(trimmed)) {
      setModelNames((prev) => [...prev, trimmed]);
    }
    setModelInput("");
  }, [modelInput, modelNames]);

  const handleRemoveModel = useCallback((model: string) => {
    setModelNames((prev) => prev.filter((m) => m !== model));
  }, []);

  const handleModelInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddModel();
    } else if (e.key === "Backspace" && !modelInput && modelNames.length > 0) {
      setModelNames((prev) => prev.slice(0, -1));
    }
  }, [handleAddModel, modelInput, modelNames]);

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);

    if (mode === "edit" && provider) {
      setName(provider.name);
      setProviderType(provider.provider_type);
      setBaseUrl(provider.base_url);
      setApiKey("");
      setExtraEnv(provider.extra_env || "{}");
      setNotes(provider.notes || "");
      setModelNames(parseModelsFromEnv(provider.extra_env || "{}"));
      setModelInput("");
      // Show advanced if extra_env has content
      try {
        const parsed = JSON.parse(provider.extra_env || "{}");
        setShowAdvanced(Object.keys(parsed).length > 0);
      } catch {
        setShowAdvanced(true);
      }
    } else if (initialPreset) {
      setName(initialPreset.name);
      setProviderType(initialPreset.provider_type);
      setBaseUrl(initialPreset.base_url);
      setApiKey("");
      // Use extra_env from preset if provided, otherwise look up by type
      const envStr = initialPreset.extra_env || PROVIDER_PRESETS[initialPreset.provider_type]?.extra_env || "{}";
      setExtraEnv(envStr);
      setNotes("");
      setModelNames(parseModelsFromEnv(envStr));
      setModelInput("");
      try {
        setShowAdvanced(Object.keys(JSON.parse(envStr)).length > 0);
      } catch {
        setShowAdvanced(false);
      }
    } else {
      setName("");
      setProviderType("anthropic");
      setBaseUrl(PROVIDER_PRESETS.anthropic.base_url);
      setApiKey("");
      setExtraEnv("{}");
      setModelNames([]);
      setModelInput("");
      setNotes("");
      setShowAdvanced(false);
    }
    setExtraEnvVersion((current) => current + 1);
  }, [open, mode, provider, initialPreset, parseModelsFromEnv]);

  const handleTypeChange = (type: string) => {
    setProviderType(type);
    const preset = PROVIDER_PRESETS[type];
    if (preset) {
      setBaseUrl(preset.base_url);
      setExtraEnv(preset.extra_env);
      setModelNames(parseModelsFromEnv(preset.extra_env));
      setModelInput("");
      try {
        setShowAdvanced(Object.keys(JSON.parse(preset.extra_env)).length > 0);
      } catch {
        setShowAdvanced(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    // Validate and normalize extra_env JSON
    let finalExtraEnv = extraEnv;
    try {
      const envObj = JSON.parse(extraEnv) as Record<string, unknown>;
      if (providerType !== 'gemini-image') {
        // Clear old single-model field
        delete envObj.ANTHROPIC_MODEL;
        delete envObj.MONOLITH_PROVIDER_MODELS;
        // Write model list
        if (modelNames.length > 0) {
          envObj.NOONFLOW_PROVIDER_MODELS = modelNames.join(",");
        } else {
          delete envObj.NOONFLOW_PROVIDER_MODELS;
        }
      }
      finalExtraEnv = JSON.stringify(envObj);
    } catch {
      setError("Extra environment variables must be valid JSON");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        provider_type: providerType,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        extra_env: finalExtraEnv,
        notes: notes.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setSaving(false);
    }
  };

  const isMaskedKey = mode === "edit" && provider?.api_key?.startsWith("***");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[28rem] overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? t('provider.editProvider') : t('provider.addProvider')}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update the API provider configuration."
              : "Configure a new API provider for Claude Code."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 min-w-0">
          <div className="space-y-2">
            <Label htmlFor="provider-name" className="text-[13px] font-medium text-muted-foreground">
              {t('provider.name')}
            </Label>
            <Input
              id="provider-name"
              placeholder="My API Provider"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-type" className="text-[13px] font-medium text-muted-foreground">
              {t('provider.providerType')}
            </Label>
            <Select value={providerType} onValueChange={handleTypeChange}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-base-url" className="text-[13px] font-medium text-muted-foreground">
              {t('provider.baseUrl')}
            </Label>
            <Input
              id="provider-base-url"
              placeholder="https://api.anthropic.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="font-mono text-sm"
            />
          </div>

          {providerType !== 'gemini-image' && (
            <div className="space-y-2">
              <Label htmlFor="provider-model-name" className="text-[13px] font-medium text-muted-foreground">
                {t('provider.modelName')}
              </Label>
              <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm focus-within:ring-1 focus-within:ring-ring">
                {modelNames.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 font-mono text-xs"
                  >
                    {m}
                    <button
                      type="button"
                      className="ml-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => handleRemoveModel(m)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  id="provider-model-name"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  onKeyDown={handleModelInputKeyDown}
                  onBlur={handleAddModel}
                  placeholder={modelNames.length === 0 ? t('provider.modelNamesPlaceholder') : ""}
                  className="min-w-[120px] flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/50"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Press Enter or comma to add. These override the default model list for this provider.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="provider-api-key" className="text-[13px] font-medium text-muted-foreground">
              {t('provider.apiKey')}
            </Label>
            <Input
              id="provider-api-key"
              type="password"
              placeholder={isMaskedKey ? "Leave empty to keep current key" : "sk-ant-..."}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-sm"
            />
          </div>

          {/* Advanced options toggle */}
          <button
            type="button"
            className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <HugeiconsIcon
              icon={showAdvanced ? ArrowUp01Icon : ArrowDown01Icon}
              className="h-3 w-3"
            />
            {t('provider.advancedOptions')}
          </button>

          {showAdvanced && (
            <div className="space-y-4 border-t border-border/40 pt-5 mt-2">
              <div className="space-y-2">
                <Label htmlFor="provider-extra-env" className="text-[13px] font-medium text-muted-foreground">
                  {t('provider.extraEnvVars')} (JSON)
                </Label>
                <CodeMirrorSourceEditor
                  value={extraEnv}
                  valueVersion={extraEnvVersion}
                  isDark={isDark}
                  language="json"
                  readOnly={false}
                  onChange={setExtraEnv}
                  className="min-h-[80px] rounded-md border border-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="provider-notes" className="text-[13px] font-medium text-muted-foreground">
                  {t('provider.notes')}
                </Label>
                <Textarea
                  id="provider-notes"
                  placeholder={t('provider.notesPlaceholder')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm"
                  rows={2}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && (
                <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />
              )}
              {saving ? t('provider.saving') : mode === "edit" ? t('provider.update') : t('provider.addProvider')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
