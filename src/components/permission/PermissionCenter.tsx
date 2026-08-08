'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Alert01Icon,
  CheckmarkCircle02Icon,
  CancelCircleIcon,
  Shield01Icon,
} from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { respondToPermission } from '@/lib/stream-session-manager';
import {
  describePermissionScope,
  getPermissionRiskLevel,
  getPermissionRiskReason,
  getRememberedPermissionScope,
  rememberPermissionScope,
} from '@/lib/permission-memory';
import { useRuntimeStore } from '@/stores/runtime-store';

interface PermissionCenterProps {
  sessionId: string;
}

export function PermissionCenter({ sessionId }: PermissionCenterProps) {
  const { t } = useTranslation();
  const [submittingDecision, setSubmittingDecision] = useState<string | null>(null);
  const snapshot = useRuntimeStore((state) => state.snapshots[sessionId] ?? null);
  const pendingPermission = snapshot?.pendingPermission ?? null;

  const rememberedScope = useMemo(
    () => (pendingPermission ? getRememberedPermissionScope(pendingPermission.toolName) : null),
    [pendingPermission],
  );

  const riskLevel = pendingPermission ? getPermissionRiskLevel(pendingPermission) : null;
  const scope = pendingPermission ? describePermissionScope(pendingPermission) : null;

  const handleDecision = async (decision: 'allow' | 'allow_session' | 'deny') => {
    if (!pendingPermission || submittingDecision) {
      return;
    }

    setSubmittingDecision(decision);
    try {
      rememberPermissionScope(pendingPermission, decision);
      await respondToPermission(sessionId, decision);
    } finally {
      setSubmittingDecision(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/55">
        <HugeiconsIcon icon={Shield01Icon} className="h-4 w-4 text-sidebar-foreground/75" />
        <span>{t('panel.permission')}</span>
      </div>

      {!pendingPermission ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          No pending permission requests.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="bg-bg-tertiary text-sidebar-foreground/88">
              {pendingPermission.toolName}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'capitalize',
                riskLevel === 'high' && 'border-red-500/25 text-red-300/85',
                riskLevel === 'medium' && 'border-amber-500/25 text-amber-300/85',
                riskLevel === 'low' && 'border-emerald-500/25 text-emerald-300/85',
              )}
            >
              {riskLevel} risk
            </Badge>
          </div>

          <div className="space-y-2 text-xs text-sidebar-foreground/72">
            <div className="flex items-start gap-2">
              <HugeiconsIcon icon={Alert01Icon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/85" />
              <div>
                <p className="font-medium text-sidebar-foreground/88">
                  {pendingPermission.description || pendingPermission.decisionReason || 'Tool requested elevated action.'}
                </p>
                <p className="mt-1 text-sidebar-foreground/62">{getPermissionRiskReason(pendingPermission)}</p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                Scope preview
              </p>
              <p className="mt-1 break-all font-mono text-sidebar-foreground/82">{scope}</p>
            </div>

            {rememberedScope && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                  Remembered preference
                </p>
                <p className="mt-1 text-sidebar-foreground/82">{rememberedScope.scope}</p>
              </div>
            )}

            {pendingPermission.toolInput && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">
                  Input preview
                </p>
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-border-subtle bg-bg-primary p-2 text-[11px] text-sidebar-foreground/80">
                  {JSON.stringify(pendingPermission.toolInput, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-border-subtle bg-bg-primary/30 text-sidebar-foreground/76 hover:bg-bg-tertiary"
              onClick={() => { void handleDecision('deny'); }}
              disabled={Boolean(submittingDecision)}
            >
              <HugeiconsIcon icon={CancelCircleIcon} className="h-3.5 w-3.5" />
              Deny
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border-default bg-bg-tertiary/70 text-sidebar-foreground hover:bg-bg-hover"
              onClick={() => { void handleDecision('allow'); }}
              disabled={Boolean(submittingDecision)}
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5" />
              Allow Once
            </Button>
            {pendingPermission.suggestions && pendingPermission.suggestions.length > 0 && (
              <Button
                size="sm"
                className="bg-primary/92 text-primary-foreground hover:bg-primary/84"
                onClick={() => { void handleDecision('allow_session'); }}
                disabled={Boolean(submittingDecision)}
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5" />
                Allow for Session
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
