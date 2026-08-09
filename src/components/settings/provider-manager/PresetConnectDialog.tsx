import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CodeMirrorSourceEditor } from '@/components/layout/CodeMirrorSourceEditor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Loading02Icon,
} from '@hugeicons/core-free-icons';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

import type { ProviderFormData } from '../ProviderForm';
import type { QuickPreset } from './constants';

interface PresetConnectDialogProps {
  preset: QuickPreset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (data: ProviderFormData) => Promise<void>;
}

export function PresetConnectDialog({
  preset,
  open,
  onOpenChange,
  onAdd,
}: PresetConnectDialogProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [name, setName] = useState('');
  const [extraEnv, setExtraEnv] = useState('{}');
  const [extraEnvVersion, setExtraEnvVersion] = useState(0);
  const [modelNames, setModelNames] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const isZh = t('nav.chats') === '对话';

  const parseModelsFromEnv = useCallback((envStr: string): string[] => {
    try {
      const parsed = JSON.parse(envStr || '{}') as Record<string, unknown>;
      const models: string[] = [];
      if (typeof parsed.ANTHROPIC_MODEL === 'string' && parsed.ANTHROPIC_MODEL.trim()) {
        models.push(parsed.ANTHROPIC_MODEL.trim());
      }
      const listVal = parsed.NOONFLOW_PROVIDER_MODELS ?? parsed.MONOLITH_PROVIDER_MODELS;
      if (typeof listVal === 'string' && listVal.trim()) {
        for (const m of listVal.split(',').map((s: string) => s.trim()).filter(Boolean)) {
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
    setModelInput('');
  }, [modelInput, modelNames]);

  const handleRemoveModel = useCallback((model: string) => {
    setModelNames((prev) => prev.filter((m) => m !== model));
  }, []);

  const handleModelInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddModel();
    } else if (e.key === 'Backspace' && !modelInput && modelNames.length > 0) {
      setModelNames((prev) => prev.slice(0, -1));
    }
  }, [handleAddModel, modelInput, modelNames]);

  useEffect(() => {
    if (!open || !preset) {
      return;
    }
    setApiKey('');
    setBaseUrl(preset.base_url);
    setName(preset.name);
    setExtraEnv(preset.extra_env);
    setModelNames(parseModelsFromEnv(preset.extra_env));
    setModelInput('');
    setError(null);
    setSaving(false);
    setShowAdvanced(false);
    setExtraEnvVersion((current) => current + 1);
  }, [open, preset, parseModelsFromEnv]);

  if (!preset) {
    return null;
  }

  const supportsModelConfig = preset.category !== 'media';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    let finalExtraEnv = extraEnv;

    if (supportsModelConfig) {
      try {
        const envObj = JSON.parse(finalExtraEnv);
        delete envObj.ANTHROPIC_MODEL;
        delete envObj.MONOLITH_PROVIDER_MODELS;
        if (modelNames.length > 0) {
          envObj.NOONFLOW_PROVIDER_MODELS = modelNames.join(',');
        } else {
          delete envObj.NOONFLOW_PROVIDER_MODELS;
        }
        finalExtraEnv = JSON.stringify(envObj);
      } catch {
        // Keep input unchanged; validation below will surface malformed JSON.
      }
    }

    try {
      JSON.parse(finalExtraEnv);
    } catch {
      setError('Extra environment variables must be valid JSON');
      return;
    }

    setSaving(true);
    try {
      await onAdd({
        name: name.trim() || preset.name,
        provider_type: preset.provider_type,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        extra_env: finalExtraEnv,
        notes: '',
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add provider');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[28rem] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {preset.icon}
            {t('provider.connect')} {preset.name}
          </DialogTitle>
          <DialogDescription>
            {isZh ? preset.descriptionZh : preset.description}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
          {preset.fields.includes('name') && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={preset.name}
                className="text-sm"
              />
            </div>
          )}

          {preset.fields.includes('base_url') && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.baseUrl')}</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="font-mono text-sm"
              />
            </div>
          )}

          {preset.fields.includes('api_key') && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">API Key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="font-mono text-sm"
                autoFocus
              />
            </div>
          )}

          {supportsModelConfig && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.modelName' as TranslationKey)}</Label>
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
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  onKeyDown={handleModelInputKeyDown}
                  onBlur={handleAddModel}
                  placeholder={modelNames.length === 0
                    ? (isZh ? '输入模型名，按回车添加' : 'Enter model name, press Enter to add')
                    : ''}
                  className="min-w-[120px] flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/50"
                />
              </div>

              <p className="text-[11px] text-muted-foreground">
                {isZh
                  ? '可选。添加后将覆盖默认模型列表，留空则使用默认模型。'
                  : 'Optional. Overrides the default model list when set. Leave empty for defaults.'}
              </p>
            </div>
          )}

          {preset.fields.includes('extra_env') && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('provider.extraEnvVars')} (JSON)</Label>
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
          )}

          {!preset.fields.includes('extra_env') && (
            <>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <HugeiconsIcon
                  icon={showAdvanced ? ArrowUp01Icon : ArrowDown01Icon}
                  className="h-3 w-3"
                />
                {t('provider.advancedOptions')}
              </button>
              {showAdvanced && (
                <div className="space-y-2 border-t border-border/50 pt-3">
                  <Label className="text-xs text-muted-foreground">{t('provider.extraEnvVars')} (JSON)</Label>
                  <CodeMirrorSourceEditor
                    value={extraEnv}
                    valueVersion={extraEnvVersion}
                    isDark={isDark}
                    language="json"
                    readOnly={false}
                    onChange={setExtraEnv}
                    className="min-h-[60px] rounded-md border border-input"
                  />
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

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
              {saving && <HugeiconsIcon icon={Loading02Icon} className="h-4 w-4 animate-spin" />}
              {saving ? t('provider.saving') : t('provider.connect')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
