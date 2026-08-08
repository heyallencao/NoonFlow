'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { HugeiconsIcon } from '@hugeicons/react';
import { ServerStack01Icon, Wifi01Icon, GlobeIcon, CodeIcon } from '@hugeicons/core-free-icons';
import { useTranslation } from '@/hooks/useTranslation';
import { CodeMirrorSourceEditor } from '@/components/layout/CodeMirrorSourceEditor';
import type { MCPServer } from '@/types';

type ServerType = 'stdio' | 'sse' | 'http';

interface McpServerEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name?: string;
  server?: MCPServer;
  onSave: (name: string, server: MCPServer) => void;
}

export function McpServerEditor({
  open,
  onOpenChange,
  name: initialName,
  server: initialServer,
  onSave,
}: McpServerEditorProps) {
  const isEditing = !!initialName;
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [name, setName] = useState(initialName || '');
  const [serverType, setServerType] = useState<ServerType>(initialServer?.type || 'stdio');
  const [command, setCommand] = useState(initialServer?.command || '');
  const [args, setArgs] = useState(initialServer?.args?.join('\n') || '');
  const [url, setUrl] = useState(initialServer?.url || '');
  const [headersText, setHeadersText] = useState(
    initialServer?.headers ? JSON.stringify(initialServer.headers, null, 2) : '{}'
  );
  const [envText, setEnvText] = useState(
    initialServer?.env ? JSON.stringify(initialServer.env, null, 2) : '{}'
  );
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect -- intentional editor reset when external source changes */
  useEffect(() => {
    if (open) {
      setName(initialName || '');
      setServerType(initialServer?.type || 'stdio');
      setCommand(initialServer?.command || '');
      setArgs(initialServer?.args?.join('\n') || '');
      setUrl(initialServer?.url || '');
      setHeadersText(initialServer?.headers ? JSON.stringify(initialServer.headers, null, 2) : '{}');
      setEnvText(initialServer?.env ? JSON.stringify(initialServer.env, null, 2) : '{}');
      setJsonMode(false);
      setJsonText(
        initialServer ? JSON.stringify(initialServer, null, 2) : '{\n  "command": "",\n  "args": []\n}'
      );
      setEditorVersion((current) => current + 1);
      setError(null);
    }
  }, [open, initialName, initialServer]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleSave() {
    setError(null);

    if (!name.trim()) {
      setError('Server name is required');
      return;
    }

    if (jsonMode) {
      try {
        const parsed = JSON.parse(jsonText);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setError('JSON must be an object');
          return;
        }
        onSave(name.trim(), parsed as MCPServer);
        onOpenChange(false);
      } catch {
        setError('Invalid JSON configuration');
      }
      return;
    }

    if (serverType === 'stdio') {
      if (!command.trim()) {
        setError('Command is required for stdio servers');
        return;
      }
    } else if (!url.trim()) {
      setError('URL is required for SSE/HTTP servers');
      return;
    }

    let env: Record<string, string> | undefined;
    try {
      const parsed = JSON.parse(envText);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        env = Object.keys(parsed).length > 0 ? parsed : undefined;
      } else {
        setError('Environment must be a JSON object');
        return;
      }
    } catch {
      setError('Invalid JSON in environment variables');
      return;
    }

    let headers: Record<string, string> | undefined;
    if (serverType !== 'stdio') {
      try {
        const parsed = JSON.parse(headersText);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          headers = Object.keys(parsed).length > 0 ? parsed : undefined;
        } else {
          setError('Headers must be a JSON object');
          return;
        }
      } catch {
        setError('Invalid JSON in headers');
        return;
      }
    }

    const serverArgs = args
      .split('\n')
      .map((segment: string) => segment.trim())
      .filter(Boolean);

    const server: MCPServer =
      serverType === 'stdio'
        ? {
            command: command.trim(),
            ...(serverArgs.length > 0 ? { args: serverArgs } : {}),
            ...(env ? { env } : {}),
          }
        : {
            command: '',
            type: serverType,
            ...(url ? { url: url.trim() } : {}),
            ...(serverArgs.length > 0 ? { args: serverArgs } : {}),
            ...(env ? { env } : {}),
            ...(headers ? { headers } : {}),
          };

    onSave(name.trim(), server);
    onOpenChange(false);
  }

  function switchToJsonMode() {
    const currentConfig: Record<string, unknown> = {};
    if (serverType !== 'stdio') {
      currentConfig.type = serverType;
      if (url) currentConfig.url = url;
    } else {
      currentConfig.command = command;
    }
    const argsArr = args.split('\n').map((segment) => segment.trim()).filter(Boolean);
    if (argsArr.length > 0) currentConfig.args = argsArr;
    try {
      const envParsed = JSON.parse(envText);
      if (Object.keys(envParsed).length > 0) currentConfig.env = envParsed;
    } catch {
      // ignore invalid transient JSON until explicit save
    }
    try {
      const headersParsed = JSON.parse(headersText);
      if (Object.keys(headersParsed).length > 0) currentConfig.headers = headersParsed;
    } catch {
      // ignore invalid transient JSON until explicit save
    }

    setJsonText(JSON.stringify(currentConfig, null, 2));
    setJsonMode(true);
    setEditorVersion((current) => current + 1);
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? `${t('mcp.editServer')}: ${initialName}` : t('mcp.addServer')}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t('mcp.editServerDescription') : t('mcp.addServerDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="server-name">{t('mcp.serverName')}</Label>
            <Input
              id="server-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="my-mcp-server"
              disabled={isEditing}
            />
          </div>

          <div className="flex items-center gap-2">
            <Label className="shrink-0">Edit Mode:</Label>
            <Button
              variant={jsonMode ? 'outline' : 'default'}
              size="sm"
              onClick={() => {
                setJsonMode(false);
                setError(null);
              }}
            >
              {t('mcp.formTab')}
            </Button>
            <Button
              variant={jsonMode ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5"
              onClick={switchToJsonMode}
            >
              <HugeiconsIcon icon={CodeIcon} className="h-3.5 w-3.5" />
              {t('mcp.jsonEditTab')}
            </Button>
          </div>

          {jsonMode ? (
            <div className="space-y-2">
              <Label>Server Configuration (JSON)</Label>
              <CodeMirrorSourceEditor
                value={jsonText}
                valueVersion={editorVersion}
                isDark={isDark}
                language="json"
                readOnly={false}
                onChange={(nextValue) => {
                  setJsonText(nextValue);
                  setError(null);
                }}
                onSaveShortcut={handleSave}
                className="min-h-[250px] rounded-md border border-input"
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>{t('mcp.serverType')}</Label>
                <Tabs
                  value={serverType}
                  onValueChange={(value) => {
                    setServerType(value as ServerType);
                    setError(null);
                  }}
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="stdio" className="flex-1 gap-1.5">
                      <HugeiconsIcon icon={ServerStack01Icon} className="h-3.5 w-3.5" />
                      stdio
                    </TabsTrigger>
                    <TabsTrigger value="sse" className="flex-1 gap-1.5">
                      <HugeiconsIcon icon={Wifi01Icon} className="h-3.5 w-3.5" />
                      SSE
                    </TabsTrigger>
                    <TabsTrigger value="http" className="flex-1 gap-1.5">
                      <HugeiconsIcon icon={GlobeIcon} className="h-3.5 w-3.5" />
                      HTTP
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {serverType === 'stdio' ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="server-command">{t('mcp.command')}</Label>
                    <Input
                      id="server-command"
                      value={command}
                      onChange={(e) => {
                        setCommand(e.target.value);
                        setError(null);
                      }}
                      placeholder="npx -y @modelcontextprotocol/server-name"
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="server-args">{t('mcp.argsLabel')}</Label>
                    <CodeMirrorSourceEditor
                      value={args}
                      valueVersion={editorVersion}
                      isDark={isDark}
                      language="text"
                      readOnly={false}
                      onChange={(nextValue) => {
                        setArgs(nextValue);
                        setError(null);
                      }}
                      onSaveShortcut={handleSave}
                      className="min-h-[80px] rounded-md border border-input"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="server-url">{t('mcp.url')}</Label>
                    <Input
                      id="server-url"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setError(null);
                      }}
                      placeholder={
                        serverType === 'sse' ? 'http://localhost:3001/sse' : 'http://localhost:3001'
                      }
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="server-headers">{t('mcp.headers')}</Label>
                    <CodeMirrorSourceEditor
                      value={headersText}
                      valueVersion={editorVersion}
                      isDark={isDark}
                      language="json"
                      readOnly={false}
                      onChange={(nextValue) => {
                        setHeadersText(nextValue);
                        setError(null);
                      }}
                      onSaveShortcut={handleSave}
                      className="min-h-[80px] rounded-md border border-input"
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="server-env">{t('mcp.envVars')}</Label>
                <CodeMirrorSourceEditor
                  value={envText}
                  valueVersion={editorVersion}
                  isDark={isDark}
                  language="json"
                  readOnly={false}
                  onChange={(nextValue) => {
                    setEnvText(nextValue);
                    setError(null);
                  }}
                  onSaveShortcut={handleSave}
                  className="min-h-[80px] rounded-md border border-input"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>{isEditing ? t('mcp.saveChanges') : t('mcp.addServer')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
