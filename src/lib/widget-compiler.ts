import {
  normalizeWidgetIR,
  normalizeWidgetTemplate,
  normalizeWidgetTitle,
  payloadLooksLikeDeclarativeWidget,
  type WidgetIR,
  type WidgetTemplate,
} from './widget-schema';
import { createWidgetTraceId, publishWidgetTelemetry } from './widget-telemetry';

export interface CompiledWidgetPayload {
  title: string;
  widget_code: string;
}

interface ChartPoint {
  label: string;
  value: number;
}

interface TimelinePoint {
  title: string;
  description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function inferTemplateFromDataset(dataset: unknown): WidgetTemplate {
  if (Array.isArray(dataset) && dataset.length > 0) {
    const first = dataset[0];
    if (typeof first === 'string') return 'list';
    if (typeof first === 'number') return 'bar';
    if (isRecord(first) && Array.isArray(first.rows)) return 'table';
    if (isRecord(first) && ('value' in first || 'count' in first || 'y' in first)) return 'bar';
  }
  if (isRecord(dataset) && Array.isArray(dataset.rows)) return 'table';
  if (isRecord(dataset) && Array.isArray(dataset.events)) return 'timeline';
  if (isRecord(dataset) && Array.isArray(dataset.steps)) return 'flow';
  if (isRecord(dataset) && Array.isArray(dataset.items)) return 'list';
  return 'stat';
}

function extractSeries(dataset: unknown): ChartPoint[] {
  const points: ChartPoint[] = [];

  const pushPoint = (labelValue: unknown, numericValue: unknown, index: number) => {
    const numeric = coerceNumber(numericValue);
    if (numeric === null) return;
    const normalizedLabel = normalizeWidgetTitle(labelValue, `Item ${index + 1}`);
    points.push({
      label: normalizedLabel,
      value: clampNumber(numeric, -1_000_000_000, 1_000_000_000),
    });
  };

  if (Array.isArray(dataset)) {
    dataset.forEach((item, index) => {
      if (typeof item === 'number' || typeof item === 'string') {
        pushPoint(`Item ${index + 1}`, item, index);
        return;
      }
      if (!isRecord(item)) {
        return;
      }
      pushPoint(
        item.label ?? item.name ?? item.x ?? `Item ${index + 1}`,
        item.value ?? item.count ?? item.y ?? item.amount,
        index,
      );
    });
    return points;
  }

  if (!isRecord(dataset)) {
    return points;
  }

  const labels = Array.isArray(dataset.labels) ? dataset.labels : [];
  const values = Array.isArray(dataset.values) ? dataset.values : [];
  if (labels.length > 0 && values.length > 0) {
    const size = Math.min(labels.length, values.length);
    for (let index = 0; index < size; index += 1) {
      pushPoint(labels[index], values[index], index);
    }
    return points;
  }

  if (Array.isArray(dataset.items)) {
    return extractSeries(dataset.items);
  }
  if (Array.isArray(dataset.series)) {
    return extractSeries(dataset.series);
  }

  if ('value' in dataset || 'count' in dataset || 'amount' in dataset) {
    pushPoint(dataset.label ?? dataset.name ?? 'Value', dataset.value ?? dataset.count ?? dataset.amount, 0);
  }

  return points;
}

function extractTimeline(dataset: unknown): TimelinePoint[] {
  const timeline: TimelinePoint[] = [];
  const items = (() => {
    if (Array.isArray(dataset)) return dataset;
    if (isRecord(dataset) && Array.isArray(dataset.events)) return dataset.events;
    if (isRecord(dataset) && Array.isArray(dataset.items)) return dataset.items;
    if (isRecord(dataset) && Array.isArray(dataset.steps)) return dataset.steps;
    return [];
  })();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (typeof item === 'string') {
      timeline.push({
        title: normalizeWidgetTitle(item, `Step ${index + 1}`),
        description: '',
      });
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }
    timeline.push({
      title: normalizeWidgetTitle(item.title ?? item.name ?? item.label, `Step ${index + 1}`),
      description: normalizeWidgetTitle(item.description ?? item.detail ?? item.value ?? '', ''),
    });
  }

  return timeline;
}

function extractTable(dataset: unknown): { columns: string[]; rows: string[][] } {
  if (isRecord(dataset) && Array.isArray(dataset.rows)) {
    const rawRows = dataset.rows as unknown[];
    const columns = toStringList(dataset.columns);
    const normalizedRows = rawRows
      .map((row) => {
        if (Array.isArray(row)) {
          return row.map((cell) => String(cell ?? ''));
        }
        if (isRecord(row)) {
          const keys = columns.length > 0 ? columns : Object.keys(row);
          return keys.map((key) => String(row[key] ?? ''));
        }
        return null;
      })
      .filter((row): row is string[] => Array.isArray(row) && row.length > 0);
    return {
      columns: columns.length > 0
        ? columns
        : normalizedRows[0]?.map((_, index) => `Column ${index + 1}`) || [],
      rows: normalizedRows,
    };
  }

  if (Array.isArray(dataset) && dataset.length > 0) {
    const first = dataset[0];
    if (Array.isArray(first)) {
      const rows = dataset
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map((cell) => String(cell ?? '')));
      const columns = rows[0]?.map((_, index) => `Column ${index + 1}`) || [];
      return { columns, rows };
    }
    if (isRecord(first)) {
      const columns = Object.keys(first);
      const rows = dataset
        .filter((row): row is Record<string, unknown> => isRecord(row))
        .map((row) => columns.map((key) => String(row[key] ?? '')));
      return { columns, rows };
    }
  }

  return { columns: [], rows: [] };
}

function buildBarSvg(title: string, points: ChartPoint[]): string {
  const width = 720;
  const height = 320;
  const paddingX = 64;
  const paddingTop = 44;
  const paddingBottom = 62;
  const chartHeight = height - paddingTop - paddingBottom;
  const chartWidth = width - paddingX * 2;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const palette = ['#4C6FFF', '#20C997', '#FFB020', '#FF6B6B', '#8B5CF6', '#14B8A6', '#EC4899'];
  const barGap = Math.max(10, chartWidth / (points.length * 4));
  const barWidth = Math.max(18, (chartWidth - barGap * (points.length - 1)) / Math.max(points.length, 1));

  const bars = points.map((point, index) => {
    const safeValue = Math.max(0, point.value);
    const normalized = safeValue / maxValue;
    const barHeight = Math.max(2, Math.round(chartHeight * normalized));
    const x = Math.round(paddingX + index * (barWidth + barGap));
    const y = paddingTop + chartHeight - barHeight;
    const label = escapeHtml(point.label.slice(0, 16));
    const valueLabel = Number.isInteger(point.value) ? String(point.value) : point.value.toFixed(2);
    return `
      <g>
        <rect x="${x}" y="${y}" width="${Math.round(barWidth)}" height="${barHeight}" rx="8" fill="${palette[index % palette.length]}" />
        <text x="${x + barWidth / 2}" y="${height - 26}" text-anchor="middle" font-size="11" fill="#55607A">${label}</text>
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="11" fill="#233048">${escapeHtml(valueLabel)}</text>
      </g>`;
  }).join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#F8FAFF" />
    <text x="${paddingX}" y="28" font-size="16" font-weight="600" fill="#1B2A4A">${escapeHtml(title)}</text>
    <line x1="${paddingX}" y1="${paddingTop + chartHeight}" x2="${paddingX + chartWidth}" y2="${paddingTop + chartHeight}" stroke="#D7DEEF" />
    ${bars}
  </svg>`;
}

function buildLineSvg(title: string, points: ChartPoint[]): string {
  const width = 720;
  const height = 320;
  const paddingX = 64;
  const paddingTop = 44;
  const paddingBottom = 56;
  const chartHeight = height - paddingTop - paddingBottom;
  const chartWidth = width - paddingX * 2;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const minValue = Math.min(...points.map((point) => point.value), 0);
  const span = Math.max(maxValue - minValue, 1);
  const segment = points.length > 1 ? chartWidth / (points.length - 1) : chartWidth;

  const toY = (value: number) => {
    const normalized = (value - minValue) / span;
    return paddingTop + chartHeight - normalized * chartHeight;
  };

  const path = points.map((point, index) => {
    const x = paddingX + index * segment;
    const y = toY(point.value);
    return `${index === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  const markers = points.map((point, index) => {
    const x = paddingX + index * segment;
    const y = toY(point.value);
    const valueLabel = Number.isInteger(point.value) ? String(point.value) : point.value.toFixed(2);
    return `
      <circle cx="${x}" cy="${y}" r="4.5" fill="#4C6FFF" />
      <text x="${x}" y="${height - 22}" text-anchor="middle" font-size="11" fill="#55607A">${escapeHtml(point.label.slice(0, 14))}</text>
      <text x="${x}" y="${y - 10}" text-anchor="middle" font-size="11" fill="#233048">${escapeHtml(valueLabel)}</text>
    `;
  }).join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#F8FAFF" />
    <text x="${paddingX}" y="28" font-size="16" font-weight="600" fill="#1B2A4A">${escapeHtml(title)}</text>
    <line x1="${paddingX}" y1="${paddingTop + chartHeight}" x2="${paddingX + chartWidth}" y2="${paddingTop + chartHeight}" stroke="#D7DEEF" />
    <path d="${path}" fill="none" stroke="#4C6FFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    ${markers}
  </svg>`;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number): { x: number; y: number } {
  const angle = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function buildPieArc(cx: number, cy: number, radius: number, start: number, end: number): string {
  const startPoint = polarToCartesian(cx, cy, radius, end);
  const endPoint = polarToCartesian(cx, cy, radius, start);
  const largeArc = end - start <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 0 ${endPoint.x} ${endPoint.y} Z`;
}

function buildPieSvg(title: string, points: ChartPoint[]): string {
  const width = 720;
  const height = 320;
  const cx = 196;
  const cy = 172;
  const radius = 108;
  const total = Math.max(points.reduce((sum, point) => sum + Math.max(0, point.value), 0), 1);
  const palette = ['#4C6FFF', '#20C997', '#FFB020', '#FF6B6B', '#8B5CF6', '#14B8A6', '#EC4899'];

  let cursor = 0;
  const slices = points.map((point, index) => {
    const safeValue = Math.max(0, point.value);
    const angle = (safeValue / total) * 360;
    const start = cursor;
    const end = cursor + angle;
    cursor = end;
    return `<path d="${buildPieArc(cx, cy, radius, start, end)}" fill="${palette[index % palette.length]}" />`;
  }).join('');

  const legends = points.map((point, index) => {
    const y = 84 + index * 28;
    const percent = ((Math.max(0, point.value) / total) * 100).toFixed(1);
    return `
      <rect x="388" y="${y - 10}" width="12" height="12" rx="3" fill="${palette[index % palette.length]}" />
      <text x="406" y="${y}" font-size="12" fill="#1B2A4A">${escapeHtml(point.label.slice(0, 24))}</text>
      <text x="658" y="${y}" text-anchor="end" font-size="12" fill="#55607A">${percent}%</text>
    `;
  }).join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#F8FAFF" />
    <text x="44" y="30" font-size="16" font-weight="600" fill="#1B2A4A">${escapeHtml(title)}</text>
    ${slices}
    ${legends}
  </svg>`;
}

function buildTimelineSvg(title: string, points: TimelinePoint[]): string {
  const width = 720;
  const rowHeight = 74;
  const height = Math.max(220, 70 + points.length * rowHeight);
  const lineX = 68;
  const nodes = points.map((point, index) => {
    const y = 72 + index * rowHeight;
    return `
      <circle cx="${lineX}" cy="${y}" r="7" fill="#4C6FFF" />
      <text x="${lineX + 26}" y="${y - 4}" font-size="13" font-weight="600" fill="#1B2A4A">${escapeHtml(point.title)}</text>
      <text x="${lineX + 26}" y="${y + 16}" font-size="12" fill="#55607A">${escapeHtml(point.description || ' ')}</text>
    `;
  }).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#F8FAFF" />
    <text x="44" y="32" font-size="16" font-weight="600" fill="#1B2A4A">${escapeHtml(title)}</text>
    <line x1="${lineX}" y1="56" x2="${lineX}" y2="${height - 30}" stroke="#CFD8F3" stroke-width="3" />
    ${nodes}
  </svg>`;
}

function buildFlowSvg(title: string, points: TimelinePoint[]): string {
  const width = 720;
  const cardWidth = 176;
  const gap = 34;
  const rows = Math.max(1, Math.ceil(points.length / 3));
  const height = 140 + rows * 106;
  const cards = points.map((point, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 44 + column * (cardWidth + gap);
    const y = 52 + row * 106;
    const arrow = column < 2 && index + 1 < points.length
      ? `<path d="M ${x + cardWidth + 8} ${y + 32} L ${x + cardWidth + 26} ${y + 32}" stroke="#A9B8E8" stroke-width="2.5" marker-end="url(#arrow)" />`
      : '';
    return `
      <g>
        <rect x="${x}" y="${y}" width="${cardWidth}" height="68" rx="12" fill="#EEF3FF" stroke="#C7D5FF" />
        <text x="${x + 12}" y="${y + 28}" font-size="13" font-weight="600" fill="#1B2A4A">${escapeHtml(point.title)}</text>
        <text x="${x + 12}" y="${y + 47}" font-size="11" fill="#55607A">${escapeHtml(point.description || ' ')}</text>
        ${arrow}
      </g>
    `;
  }).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M 0 0 L 8 4 L 0 8 z" fill="#A9B8E8" />
      </marker>
    </defs>
    <rect width="${width}" height="${height}" rx="18" fill="#F8FAFF" />
    <text x="44" y="30" font-size="16" font-weight="600" fill="#1B2A4A">${escapeHtml(title)}</text>
    ${cards}
  </svg>`;
}

function buildStatSvg(title: string, points: ChartPoint[]): string {
  const width = 720;
  const height = 220;
  const primary = points[0];
  const secondary = points[1];
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#F8FAFF" />
    <text x="44" y="36" font-size="16" font-weight="600" fill="#1B2A4A">${escapeHtml(title)}</text>
    <text x="44" y="112" font-size="48" font-weight="700" fill="#1A2D70">${escapeHtml(primary ? String(primary.value) : '0')}</text>
    <text x="44" y="138" font-size="13" fill="#55607A">${escapeHtml(primary?.label || 'Primary metric')}</text>
    <rect x="392" y="62" width="284" height="104" rx="14" fill="#EEF3FF" />
    <text x="416" y="107" font-size="33" font-weight="650" fill="#1F3EA5">${escapeHtml(secondary ? String(secondary.value) : '--')}</text>
    <text x="416" y="128" font-size="12" fill="#55607A">${escapeHtml(secondary?.label || 'Secondary metric')}</text>
  </svg>`;
}

function buildProgressSvg(title: string, points: ChartPoint[]): string {
  const width = 720;
  const rowHeight = 36;
  const height = Math.max(210, 84 + points.length * rowHeight);
  const bars = points.map((point, index) => {
    const y = 62 + index * rowHeight;
    const percent = clampNumber(point.value, 0, 100);
    const fillWidth = Math.round((percent / 100) * 480);
    return `
      <text x="44" y="${y + 12}" font-size="12" fill="#324056">${escapeHtml(point.label)}</text>
      <rect x="206" y="${y}" width="480" height="16" rx="8" fill="#E2E8FB" />
      <rect x="206" y="${y}" width="${fillWidth}" height="16" rx="8" fill="#4C6FFF" />
      <text x="696" y="${y + 12}" text-anchor="end" font-size="12" fill="#324056">${Math.round(percent)}%</text>
    `;
  }).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <rect width="${width}" height="${height}" rx="18" fill="#F8FAFF" />
    <text x="44" y="34" font-size="16" font-weight="600" fill="#1B2A4A">${escapeHtml(title)}</text>
    ${bars}
  </svg>`;
}

function buildListHtml(title: string, timeline: TimelinePoint[]): string {
  const items = timeline
    .map((item) => `<li><strong>${escapeHtml(item.title)}</strong>${item.description ? `: ${escapeHtml(item.description)}` : ''}</li>`)
    .join('');
  return `<section aria-label="${escapeHtml(title)}"><h3>${escapeHtml(title)}</h3><ul>${items}</ul></section>`;
}

function buildTableHtml(title: string, table: { columns: string[]; rows: string[][] }): string {
  if (table.columns.length === 0 || table.rows.length === 0) {
    return `<section aria-label="${escapeHtml(title)}"><h3>${escapeHtml(title)}</h3><p>No data</p></section>`;
  }

  const head = table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const body = table.rows.map((row) => {
    const cells = row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `<section aria-label="${escapeHtml(title)}"><h3>${escapeHtml(title)}</h3><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function compileFromIR(ir: WidgetIR): string {
  const points = extractSeries(ir.dataset).slice(0, 12);
  const timeline = extractTimeline(ir.dataset).slice(0, 12);
  const table = extractTable(ir.dataset);

  switch (ir.template) {
    case 'bar':
      return buildBarSvg(ir.title, points.length > 0 ? points : [{ label: 'Value', value: 0 }]);
    case 'line':
      return buildLineSvg(ir.title, points.length > 0 ? points : [{ label: 'Value', value: 0 }]);
    case 'pie':
      return buildPieSvg(ir.title, points.length > 0 ? points : [{ label: 'Value', value: 100 }]);
    case 'timeline':
      return buildTimelineSvg(ir.title, timeline.length > 0 ? timeline : [{ title: 'Step 1', description: '' }]);
    case 'flow':
      return buildFlowSvg(ir.title, timeline.length > 0 ? timeline : [{ title: 'Start', description: '' }, { title: 'Finish', description: '' }]);
    case 'progress':
      return buildProgressSvg(ir.title, points.length > 0 ? points : [{ label: 'Progress', value: 0 }]);
    case 'list':
      return buildListHtml(ir.title, timeline.length > 0 ? timeline : [{ title: 'No items', description: '' }]);
    case 'table':
      return buildTableHtml(ir.title, table);
    case 'stat':
    default:
      return buildStatSvg(ir.title, points.length > 0 ? points : [{ label: 'Value', value: 0 }]);
  }
}

function tryParseJson(rawPayload: string): unknown {
  const trimmed = rawPayload.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(trimmed.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

function normalizeIRFromPayload(payload: unknown): WidgetIR | null {
  if (!isRecord(payload)) {
    return null;
  }

  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const layout = Array.isArray(payload.layout) ? payload.layout : [];
  const widgets = Array.isArray(payload.widgets) ? payload.widgets : [];
  const candidates = [
    ...sections.filter((item): item is Record<string, unknown> => isRecord(item)),
    ...layout.filter((item): item is Record<string, unknown> => isRecord(item)),
    ...widgets.filter((item): item is Record<string, unknown> => isRecord(item)),
    payload,
  ];

  const rootTitle = normalizeWidgetTitle(payload.title, 'generated_widget');

  for (const candidate of candidates) {
    const explicitTemplate = normalizeWidgetTemplate(
      candidate.template
      ?? candidate.type
      ?? candidate.chart
      ?? candidate.kind
      ?? candidate.widget,
    );
    const dataset = candidate.dataset
      ?? candidate.data
      ?? candidate.series
      ?? candidate.items
      ?? candidate.rows
      ?? candidate.values
      ?? payload.dataset
      ?? payload.data;
    const template = explicitTemplate || inferTemplateFromDataset(dataset);
    const normalized = normalizeWidgetIR({
      template,
      title: candidate.title ?? rootTitle,
      dataset,
      encoding: candidate.encoding ?? payload.encoding,
      actions: candidate.actions ?? payload.actions,
      theme: candidate.theme ?? payload.theme,
      ariaLabel: candidate.ariaLabel ?? candidate['aria-label'] ?? rootTitle,
    });
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function compileDeclarativeWidgetPayload(rawPayload: string | unknown): CompiledWidgetPayload | null {
  const traceId = createWidgetTraceId('compile_declarative');
  const payload = typeof rawPayload === 'string' ? tryParseJson(rawPayload) : rawPayload;
  if (!payloadLooksLikeDeclarativeWidget(payload)) {
    publishWidgetTelemetry({
      event: 'widget_compile',
      ok: false,
      code: 'W_COMPILE_UNSUPPORTED_INPUT',
      traceId,
      meta: {
        source: 'declarative',
      },
    });
    return null;
  }
  const ir = normalizeIRFromPayload(payload);
  if (!ir) {
    publishWidgetTelemetry({
      event: 'widget_compile',
      ok: false,
      code: 'W_COMPILE_TEMPLATE_UNSUPPORTED',
      traceId,
      meta: {
        source: 'declarative',
      },
    });
    return null;
  }
  const widgetCode = compileFromIR(ir);
  if (!widgetCode.trim()) {
    publishWidgetTelemetry({
      event: 'widget_compile',
      ok: false,
      code: 'W_COMPILE_EMPTY_DATA',
      traceId,
      meta: {
        source: 'declarative',
        template: ir.template,
      },
    });
    return null;
  }
  publishWidgetTelemetry({
    event: 'widget_compile',
    ok: true,
    traceId,
    meta: {
      source: 'declarative',
      template: ir.template,
      title: ir.title,
    },
  });
  return {
    title: ir.title,
    widget_code: widgetCode,
  };
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function parseMarkdownTableRows(raw: string): string[][] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));
  if (lines.length < 2) {
    return [];
  }
  const rows = lines
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length > 1);
  if (rows.length < 2) {
    return [];
  }
  const divider = rows[1];
  const isDivider = divider.every((cell) => /^:?-{3,}:?$/.test(cell));
  if (!isDivider) {
    return rows;
  }
  return [rows[0], ...rows.slice(2)];
}

function buildWidgetFromRows(rows: string[][], title: string): CompiledWidgetPayload | null {
  if (rows.length < 2) {
    return null;
  }
  const [header, ...dataRows] = rows;
  const numericColumnIndex = header.findIndex((_, columnIndex) => {
    const numericCount = dataRows.reduce((count, row) => {
      const value = row[columnIndex];
      return coerceNumber(value) !== null ? count + 1 : count;
    }, 0);
    return numericCount >= Math.max(1, Math.ceil(dataRows.length * 0.6));
  });

  if (numericColumnIndex > 0) {
    const series: ChartPoint[] = dataRows.slice(0, 10).map((row, index) => ({
      label: normalizeWidgetTitle(row[0] ?? `Item ${index + 1}`, `Item ${index + 1}`),
      value: coerceNumber(row[numericColumnIndex]) ?? 0,
    }));
    const ir = normalizeWidgetIR({
      template: 'bar',
      title,
      dataset: series,
      ariaLabel: title,
    });
    if (!ir) {
      return null;
    }
    return {
      title: ir.title,
      widget_code: compileFromIR(ir),
    };
  }

  const tableRows = dataRows.map((row) => row.map((value) => value.trim()));
  const ir = normalizeWidgetIR({
    template: 'table',
    title,
    dataset: {
      columns: header,
      rows: tableRows,
    },
    ariaLabel: title,
  });
  if (!ir) {
    return null;
  }
  return {
    title: ir.title,
    widget_code: compileFromIR(ir),
  };
}

export function compileTabularWidgetFence(
  kind: 'table' | 'csv' | 'tsv',
  rawPayload: string,
): CompiledWidgetPayload | null {
  const traceId = createWidgetTraceId(`compile_${kind}`);
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    publishWidgetTelemetry({
      event: 'widget_compile',
      ok: false,
      code: 'W_COMPILE_EMPTY_DATA',
      traceId,
      meta: { source: 'tabular', kind },
    });
    return null;
  }
  const rows = kind === 'table'
    ? parseMarkdownTableRows(trimmed)
    : trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => splitDelimitedLine(line, kind === 'csv' ? ',' : '\t'));
  const compiled = buildWidgetFromRows(rows, kind === 'table' ? 'Table dashboard' : 'Tabular dashboard');
  publishWidgetTelemetry({
    event: 'widget_compile',
    ok: Boolean(compiled),
    code: compiled ? undefined : 'W_COMPILE_UNSUPPORTED_INPUT',
    traceId,
    meta: {
      source: 'tabular',
      kind,
      rowCount: rows.length,
    },
  });
  return compiled;
}
