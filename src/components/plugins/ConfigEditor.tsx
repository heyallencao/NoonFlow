'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { CodeMirrorSourceEditor } from '@/components/layout/CodeMirrorSourceEditor';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';

interface ConfigEditorProps {
  value: string;
  onSave: (value: string) => void;
  label?: string;
}

export function ConfigEditor({ value, onSave, label }: ConfigEditorProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [text, setText] = useState(value);
  const [editorVersion, setEditorVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional editor reset when external source changes */
  useEffect(() => {
    setText(value);
    setEditorVersion((current) => current + 1);
  }, [value]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleSave() {
    try {
      JSON.parse(text);
      setError(null);
      onSave(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  function handleFormat() {
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      setText(formatted);
      setEditorVersion((current) => current + 1);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <CodeMirrorSourceEditor
        value={text}
        valueVersion={editorVersion}
        isDark={isDark}
        language="json"
        readOnly={false}
        onChange={(nextValue) => {
          setText(nextValue);
          setError(null);
        }}
        onSaveShortcut={handleSave}
        className="min-h-[200px] w-full rounded-md border border-input"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave}>
          {t('common.save')}
        </Button>
        <Button size="sm" variant="outline" onClick={handleFormat}>
          Format
        </Button>
      </div>
    </div>
  );
}
