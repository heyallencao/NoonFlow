"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface VerticalResizeHandleProps {
  onResize: (deltaY: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  label?: string;
  atUpperLimit?: boolean;
  upperLimitLabel?: string;
}

function clearDragStyles() {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

export function VerticalResizeHandle({
  onResize,
  onResizeStart,
  onResizeEnd,
  label,
  atUpperLimit = false,
  upperLimitLabel = "Reached top limit",
}: VerticalResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const startY = useRef(0);

  const finishDrag = useCallback(
    (shouldReleaseCapture: boolean) => {
      if (!isDragging.current) return;

      const handle = handleRef.current;
      const pointerId = pointerIdRef.current;

      isDragging.current = false;
      pointerIdRef.current = null;
      setDragging(false);

      if (
        shouldReleaseCapture
        && handle
        && pointerId !== null
        && handle.hasPointerCapture(pointerId)
      ) {
        handle.releasePointerCapture(pointerId);
      }

      clearDragStyles();
      onResizeEnd?.();
    },
    [onResizeEnd]
  );

  useEffect(() => {
    return () => {
      clearDragStyles();
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    onResizeStart?.();
    isDragging.current = true;
    pointerIdRef.current = e.pointerId;
    startY.current = e.clientY;
    setDragging(true);

    handleRef.current = e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [onResizeStart]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      const delta = e.clientY - startY.current;
      startY.current = e.clientY;
      onResize(delta);
    },
    [onResize]
  );

  const handlePointerUp = useCallback(() => {
    finishDrag(true);
  }, [finishDrag]);

  const handlePointerCancel = useCallback(() => {
    finishDrag(true);
  }, [finishDrag]);

  const handleLostPointerCapture = useCallback(() => {
    finishDrag(false);
  }, [finishDrag]);

  return (
    <div className="relative z-10 h-0 w-full shrink-0">
      <div
        ref={handleRef}
        role="separator"
        aria-orientation="horizontal"
        aria-label={label ?? "Resize terminal panel"}
        data-testid="terminal-panel-resize-handle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        className={cn(
          "group absolute inset-x-0 top-1/2 flex h-4 -translate-y-1/2 cursor-row-resize touch-none items-center justify-center",
          dragging && "z-20"
        )}
      >
        {dragging && atUpperLimit && (
          <div className="pointer-events-none absolute -top-6 rounded-md border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            {upperLimitLabel}
          </div>
        )}
        <div
          className={cn(
            "w-full rounded-full transition-all duration-150",
            dragging && atUpperLimit
              ? "h-[2px] bg-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.28)]"
              : dragging
              ? "h-[2px] bg-border shadow-[0_0_0_1px_rgba(148,163,184,0.3)]"
              : "h-px bg-border/40 group-hover:bg-border group-hover:shadow-[0_0_0_1px_rgba(148,163,184,0.18)]"
          )}
        />
      </div>
    </div>
  );
}
