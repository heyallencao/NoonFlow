export const WIDGET_IR_VERSION = '1.0' as const;

export const WIDGET_TEMPLATES = [
  'bar',
  'line',
  'pie',
  'table',
  'timeline',
  'flow',
  'stat',
  'progress',
  'list',
] as const;

export type WidgetTemplate = (typeof WIDGET_TEMPLATES)[number];

export interface WidgetIR {
  ir_version: typeof WIDGET_IR_VERSION;
  template: WidgetTemplate;
  title: string;
  dataset: Record<string, unknown>;
  encoding: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  theme: 'default' | 'brand';
  a11y: {
    ariaLabel: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTemplate(value: string): value is WidgetTemplate {
  return (WIDGET_TEMPLATES as readonly string[]).includes(value);
}

function hasExplicitWidgetDescriptor(payload: Record<string, unknown>): boolean {
  return Boolean(
    normalizeWidgetTemplate(payload.template)
    || normalizeWidgetTemplate(payload.type)
    || normalizeWidgetTemplate(payload.chart)
    || normalizeWidgetTemplate(payload.kind)
    || normalizeWidgetTemplate(payload.widget),
  );
}

function hasStructuredWidgetData(payload: Record<string, unknown>): boolean {
  return (
    isRecord(payload.dataset)
    || isRecord(payload.data)
    || Array.isArray(payload.data)
    || Array.isArray(payload.dataset)
    || Array.isArray(payload.series)
    || Array.isArray(payload.items)
    || Array.isArray(payload.rows)
    || Array.isArray(payload.values)
  );
}

function hasWidgetConfigurationHints(payload: Record<string, unknown>): boolean {
  return Boolean(
    isRecord(payload.encoding)
    || Array.isArray(payload.actions)
    || payload.theme === 'default'
    || payload.theme === 'brand'
    || typeof payload.ariaLabel === 'string'
    || typeof payload['aria-label'] === 'string'
    || isRecord(payload.a11y),
  );
}

function getNestedWidgetCollections(payload: Record<string, unknown>): unknown[][] {
  return [
    Array.isArray(payload.sections) ? payload.sections : [],
    Array.isArray(payload.layout) ? payload.layout : [],
    Array.isArray(payload.widgets) ? payload.widgets : [],
  ];
}

export function normalizeWidgetTitle(value: unknown, fallback = 'generated_widget'): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return fallback;
  const compact = raw.replace(/\s+/g, ' ').slice(0, 80);
  return compact || fallback;
}

export function normalizeWidgetTemplate(value: unknown): WidgetTemplate | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (isTemplate(normalized)) {
    return normalized;
  }

  if (normalized.includes('line') || normalized.includes('trend')) return 'line';
  if (normalized.includes('pie') || normalized.includes('donut')) return 'pie';
  if (normalized.includes('table') || normalized.includes('grid')) return 'table';
  if (normalized.includes('timeline')) return 'timeline';
  if (normalized.includes('flow') || normalized.includes('process')) return 'flow';
  if (normalized.includes('stat') || normalized.includes('metric')) return 'stat';
  if (normalized.includes('progress')) return 'progress';
  if (normalized.includes('list')) return 'list';
  if (normalized.includes('bar') || normalized.includes('column')) return 'bar';
  return null;
}

export function payloadLooksLikeDeclarativeWidget(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (typeof payload.widget_code === 'string' || typeof payload.widgetCode === 'string') {
    return false;
  }

  if (hasExplicitWidgetDescriptor(payload)) {
    return true;
  }

  if (getNestedWidgetCollections(payload).some((collection) => collection.length > 0)) {
    return true;
  }

  if (hasStructuredWidgetData(payload)) {
    return true;
  }

  return false;
}

export function payloadLooksLikeJsonWidgetCandidate(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  if (typeof payload.widget_code === 'string' || typeof payload.widgetCode === 'string') {
    return false;
  }

  if (hasExplicitWidgetDescriptor(payload)) {
    return true;
  }

  if (getNestedWidgetCollections(payload).some((collection) => (
    collection.some((item) => payloadLooksLikeJsonWidgetCandidate(item))
  ))) {
    return true;
  }

  return hasStructuredWidgetData(payload) && hasWidgetConfigurationHints(payload);
}

export function normalizeWidgetIR(input: {
  template: unknown;
  title?: unknown;
  dataset?: unknown;
  encoding?: unknown;
  actions?: unknown;
  theme?: unknown;
  ariaLabel?: unknown;
}): WidgetIR | null {
  const template = normalizeWidgetTemplate(input.template);
  if (!template) {
    return null;
  }

  const title = normalizeWidgetTitle(input.title);
  const dataset = isRecord(input.dataset) ? input.dataset : { value: input.dataset };
  const encoding = isRecord(input.encoding) ? input.encoding : {};
  const actions = Array.isArray(input.actions)
    ? input.actions.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
  const theme = input.theme === 'brand' ? 'brand' : 'default';

  return {
    ir_version: WIDGET_IR_VERSION,
    template,
    title,
    dataset,
    encoding,
    actions,
    theme,
    a11y: {
      ariaLabel: normalizeWidgetTitle(input.ariaLabel, title),
    },
  };
}
