"use client";

import { useSplit } from "@/hooks/useSplit";
import { SplitColumn } from "./SplitColumn";

export function SplitChatContainer() {
  const { splitSessions, activeColumnId, removeFromSplit, setActiveColumn } = useSplit();

  return (
    <div className="flex h-full gap-0">
      {splitSessions.map((session, index) => (
        <div key={session.sessionId} className="contents">
          {index > 0 && (
            <div className="w-px bg-border shrink-0" />
          )}
          <SplitColumn
            sessionId={session.sessionId}
            isActive={activeColumnId === session.sessionId}
            onClose={() => removeFromSplit(session.sessionId)}
            onFocus={() => setActiveColumn(session.sessionId)}
          />
        </div>
      ))}
    </div>
  );
}
