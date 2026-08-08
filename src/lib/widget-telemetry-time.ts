const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_PAST_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const TIMESTAMP_WITH_TIMEZONE_RE = /(?:[zZ]|[+\-]\d{2}:\d{2})$/;
const TIMESTAMP_WITHOUT_TIMEZONE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

function toUtcDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function parseTimezoneLessUtcTimestamp(rawValue: string): Date | null {
  const match = rawValue.match(TIMESTAMP_WITHOUT_TIMEZONE_RE);
  if (!match) {
    return null;
  }

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText = '00',
    minuteText = '00',
    secondText = '00',
    millisecondText = '000',
  ] = match;

  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const second = Number.parseInt(secondText, 10);
  const millisecond = Number.parseInt(millisecondText.padEnd(3, '0').slice(0, 3), 10);

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour
    || parsed.getUTCMinutes() !== minute
    || parsed.getUTCSeconds() !== second
    || parsed.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }

  return parsed;
}

function parseTelemetryTimestamp(rawValue: string): Date {
  if (TIMESTAMP_WITH_TIMEZONE_RE.test(rawValue)) {
    return new Date(rawValue);
  }

  return parseTimezoneLessUtcTimestamp(rawValue) ?? new Date(rawValue);
}

export function parseTelemetryCreatedAt(rawValue: unknown): Date | null {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parseTelemetryTimestamp(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function normalizeTelemetryCreatedAt(rawValue: unknown, nowMs: number = Date.now()): string | undefined {
  const parsed = parseTelemetryCreatedAt(rawValue);
  if (!parsed) {
    return undefined;
  }
  const timestamp = parsed.getTime();
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  if (timestamp > nowMs + MAX_FUTURE_SKEW_MS) {
    return undefined;
  }
  if (timestamp < nowMs - MAX_PAST_AGE_MS) {
    return undefined;
  }
  return toUtcDateTime(parsed);
}
