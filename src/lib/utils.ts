import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse a date string from the database as UTC.
 *
 * DB timestamps are stored as UTC but without timezone indicator
 * (e.g. "2026-02-26 07:23:45"). `new Date()` would misinterpret
 * these as local time. This helper normalises the string so the
 * browser always treats it as UTC.
 */
export function parseDBDate(dateStr: string): Date {
  if (!dateStr) return new Date(0);
  // Already has timezone info (ISO with Z or offset) — parse as-is
  if (dateStr.includes('Z') || dateStr.includes('+') || /T\d{2}:\d{2}:\d{2}[+-]/.test(dateStr)) {
    return new Date(dateStr);
  }
  // DB format "YYYY-MM-DD HH:mm:ss" — append Z to mark as UTC
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}
