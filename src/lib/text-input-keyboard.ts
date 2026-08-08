import type { KeyboardEvent as ReactKeyboardEvent } from "react"

import { isImeComposingEvent } from "@/lib/ime"

type TextInputElement = HTMLInputElement | HTMLTextAreaElement

type NavigationIntent = "line-start" | "line-end"

function isMacLikePlatform() {
  if (typeof navigator === "undefined") {
    return false
  }

  const platform =
    ("userAgentData" in navigator
      ? (
          navigator as Navigator & {
            userAgentData?: { platform?: string }
          }
        ).userAgentData?.platform
      : undefined) ??
    navigator.platform ??
    ""
  return /mac|iphone|ipad|ipod/i.test(platform)
}

function resolveNavigationIntent(
  event: ReactKeyboardEvent<TextInputElement>
): NavigationIntent | null {
  if (event.key === "Home") {
    return "line-start"
  }

  if (event.key === "End") {
    return "line-end"
  }

  const isFnPressed = event.getModifierState?.("Fn") ?? false
  if (isFnPressed && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key === "ArrowLeft") {
      return "line-start"
    }
    if (event.key === "ArrowRight") {
      return "line-end"
    }
  }

  if (event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key === "ArrowLeft") {
      return "line-start"
    }
    if (event.key === "ArrowRight") {
      return "line-end"
    }
  }

  if (
    isMacLikePlatform() &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    (event.key === "a" || event.key === "e")
  ) {
    return event.key === "a" ? "line-start" : "line-end"
  }

  return null
}

function getLineBounds(value: string, cursor: number) {
  const lineStart = cursor <= 0 ? 0 : value.lastIndexOf("\n", cursor - 1) + 1
  const lineEndCandidate = value.indexOf("\n", cursor)
  const lineEnd = lineEndCandidate === -1 ? value.length : lineEndCandidate

  return { lineEnd, lineStart }
}

function selectPosition(
  element: TextInputElement,
  position: number,
  extendSelection: boolean
) {
  const selectionStart = element.selectionStart
  const selectionEnd = element.selectionEnd

  if (selectionStart === null || selectionEnd === null) {
    return false
  }

  const direction = element.selectionDirection ?? "none"
  const anchor = direction === "backward" ? selectionEnd : selectionStart

  if (!extendSelection) {
    element.setSelectionRange(position, position)
    return true
  }

  const nextDirection = position < anchor ? "backward" : "forward"
  element.setSelectionRange(
    Math.min(anchor, position),
    Math.max(anchor, position),
    nextDirection
  )
  return true
}

function getCursorPosition(element: TextInputElement) {
  const selectionStart = element.selectionStart
  const selectionEnd = element.selectionEnd

  if (selectionStart === null || selectionEnd === null) {
    return null
  }

  const direction = element.selectionDirection ?? "none"
  return direction === "backward" ? selectionStart : selectionEnd
}

/**
 * Normalize line start/end navigation for text inputs in desktop webviews.
 * Returns true when the key event has been handled.
 */
export function applyTextInputNavigationKeydown(
  event: ReactKeyboardEvent<TextInputElement>
): boolean {
  if (event.defaultPrevented || isImeComposingEvent(event)) {
    return false
  }

  const intent = resolveNavigationIntent(event)
  if (!intent) {
    return false
  }

  const target = event.currentTarget
  const cursor = getCursorPosition(target)
  if (cursor === null) {
    return false
  }

  const { lineStart, lineEnd } = getLineBounds(target.value, cursor)
  const nextPosition = intent === "line-start" ? lineStart : lineEnd
  const handled = selectPosition(target, nextPosition, event.shiftKey)

  if (handled) {
    event.preventDefault()
  }

  return handled
}
