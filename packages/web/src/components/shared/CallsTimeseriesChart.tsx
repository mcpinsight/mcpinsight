import type * as React from 'react';

import type { TimeseriesPoint } from '@/api/client';
import { copy } from '@/copy/en';

/**
 * Minimal inline-SVG line chart — one line per day's call count over the
 * detail-page window. Architect note (Day 21 ADR-0004 §Follow-up): shipping
 * this in raw SVG instead of pulling `visx` keeps the chart under 50 LOC,
 * adds zero runtime dependencies, and respects the `skills/frontend-react.md`
 * P5 anti-pattern guard. Visx becomes justifiable when we need tooltips /
 * zoom / brushes; not today.
 */
const WIDTH = 480;
const HEIGHT = 192;
const PADDING = { top: 12, right: 12, bottom: 24, left: 32 };

export interface CallsTimeseriesChartProps {
  points: ReadonlyArray<TimeseriesPoint>;
  ariaLabel?: string;
}

export function CallsTimeseriesChart({
  points,
  ariaLabel,
}: CallsTimeseriesChartProps): React.ReactElement {
  if (points.length === 0) {
    return (
      <div
        className="flex h-48 w-full items-center justify-center rounded-md bg-muted/40 text-sm text-muted-foreground"
        role="img"
        aria-label={ariaLabel ?? copy.detail.chartEmpty}
      >
        {copy.detail.chartEmpty}
      </div>
    );
  }

  const maxCalls = Math.max(1, ...points.map((p) => p.calls));
  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = PADDING.left + i * stepX;
    const y = PADDING.top + innerH - (p.calls / maxCalls) * innerH;
    return { x, y, day: p.day, calls: p.calls };
  });

  const linePath = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(' ');

  const firstDay = points[0]?.day ?? '';
  const lastDay = points.at(-1)?.day ?? '';

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-48 w-full"
      role="img"
      aria-label={ariaLabel ?? `Calls per day from ${firstDay} to ${lastDay}, peak ${maxCalls}`}
      data-testid="timeseries-chart"
    >
      <title>{`Calls per day — max ${maxCalls}`}</title>
      {/* Y-axis gridline at max */}
      <line
        x1={PADDING.left}
        y1={PADDING.top}
        x2={WIDTH - PADDING.right}
        y2={PADDING.top}
        stroke="currentColor"
        strokeOpacity={0.1}
      />
      <line
        x1={PADDING.left}
        y1={HEIGHT - PADDING.bottom}
        x2={WIDTH - PADDING.right}
        y2={HEIGHT - PADDING.bottom}
        stroke="currentColor"
        strokeOpacity={0.2}
      />
      <text
        x={PADDING.left - 4}
        y={PADDING.top + 4}
        fontSize="10"
        textAnchor="end"
        className="fill-muted-foreground"
      >
        {maxCalls}
      </text>
      <text
        x={PADDING.left - 4}
        y={HEIGHT - PADDING.bottom + 4}
        fontSize="10"
        textAnchor="end"
        className="fill-muted-foreground"
      >
        0
      </text>
      <text x={PADDING.left} y={HEIGHT - 6} fontSize="10" className="fill-muted-foreground">
        {firstDay}
      </text>
      <text
        x={WIDTH - PADDING.right}
        y={HEIGHT - 6}
        fontSize="10"
        textAnchor="end"
        className="fill-muted-foreground"
      >
        {lastDay}
      </text>
      <path d={linePath} fill="none" stroke="#10b981" strokeWidth={2} strokeLinejoin="round" />
      {coords.map((c) => (
        <circle key={c.day} cx={c.x} cy={c.y} r={2.5} fill="#10b981">
          <title>{`${c.day}: ${c.calls} calls`}</title>
        </circle>
      ))}
    </svg>
  );
}
