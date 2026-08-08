"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  side: "left" | "right";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  label?: string;
}

function clearDragStyles() {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

export function ResizeHandle({ side, onResize, onResizeEnd, label }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const startX = useRef(0);

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

    isDragging.current = true;
    pointerIdRef.current = e.pointerId;
    startX.current = e.clientX;
    setDragging(true);

    handleRef.current = e.currentTarget;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
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
    <div
      className={cn(
        "relative z-10 h-full w-0 shrink-0",
        side === "left" ? "-ml-3" : "-mr-3"
      )}
    >
      <div
        ref={handleRef}
        role="separator"
        aria-orientation="vertical"
        aria-label={label ?? `Resize ${side} panel`}
        data-testid={label ? `${label}-resize-handle` : `${side}-resize-handle`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        className={cn(
          "group absolute inset-y-0 left-1/2 flex w-4 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center",
          dragging && "z-20"
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-150",
            dragging
              ? "w-[2px] bg-border shadow-[0_0_0_1px_rgba(148,163,184,0.3)]"
              : "w-px bg-border/40 group-hover:bg-border group-hover:shadow-[0_0_0_1px_rgba(148,163,184,0.18)]"
          )}
        />
      </div>
    </div>
  );
}
