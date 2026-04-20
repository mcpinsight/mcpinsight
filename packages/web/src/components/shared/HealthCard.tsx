import type { ServerHealth } from '@mcpinsight/core/types';
import type * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { copy } from '@/copy/en';
import { cn } from '@/util/cn';
import { t } from '@/util/format';

const FACTOR_ORDER = [
  { key: 'activation', weight: 30 },
  { key: 'successRate', weight: 30 },
  { key: 'toolUtil', weight: 20 },
  { key: 'clarity', weight: 10 },
  { key: 'tokenEff', weight: 10 },
] as const satisfies ReadonlyArray<{
  key: keyof NonNullable<ServerHealth['components']>;
  weight: number;
}>;

export interface HealthCardProps {
  health: ServerHealth | undefined;
  daysOfHistory: number | null;
  totalCalls: number;
}

/**
 * Detail-page Health Score card. Three display branches:
 *   1. Insufficient-data (`health.score === null`) — show reason + numbers.
 *   2. Numeric score + 5 factor bars — the happy path.
 *   3. Loading (`health === undefined`) — skeletons.
 */
export function HealthCard({
  health,
  daysOfHistory,
  totalCalls,
}: HealthCardProps): React.ReactElement {
  return (
    <Card data-testid="health-card">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs uppercase">{copy.detail.healthTitle}</CardTitle>
        {health?.is_essential && (
          <span
            className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700"
            data-testid="essential-badge"
          >
            {copy.detail.healthEssentialBadge}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {health === undefined ? <HealthCardLoading /> : null}
        {health && health.score === null ? (
          <InsufficientDataBody
            daysOfHistory={daysOfHistory}
            totalCalls={totalCalls}
            reason={health.insufficient_data_reason}
          />
        ) : null}
        {health && health.score !== null && health.components !== null ? (
          <ScoreBody score={health.score} components={health.components} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function HealthCardLoading(): React.ReactElement {
  return (
    <div className="space-y-3" aria-label={copy.detail.loading}>
      <div className="h-10 w-24 animate-pulse rounded-sm bg-muted" />
      <div className="h-2 w-full animate-pulse rounded-sm bg-muted" />
      <div className="h-2 w-full animate-pulse rounded-sm bg-muted" />
      <div className="h-2 w-full animate-pulse rounded-sm bg-muted" />
    </div>
  );
}

function ScoreBody({
  score,
  components,
}: {
  score: number;
  components: NonNullable<ServerHealth['components']>;
}): React.ReactElement {
  const scoreColor = colorForScore(score);
  return (
    <>
      <div className="flex items-baseline gap-2">
        <div className={cn('text-4xl font-semibold tabular-nums', scoreColor)}>{score}</div>
        <div className="text-xs text-muted-foreground">{copy.detail.healthOutOf}</div>
      </div>
      <dl className="mt-4 space-y-2" data-testid="health-factors">
        {FACTOR_ORDER.map(({ key, weight }) => (
          <FactorBar
            key={key}
            label={copy.detail.healthFactors[key]}
            value={components[key]}
            weight={weight}
          />
        ))}
      </dl>
    </>
  );
}

function FactorBar({
  label,
  value,
  weight,
}: {
  label: string;
  value: number;
  weight: number;
}): React.ReactElement {
  const clamped = Math.max(0, Math.min(1, value));
  const pct = Math.round(clamped * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <dt className="text-muted-foreground">
          {label} <span className="text-[10px] opacity-60">· {weight}%</span>
        </dt>
        <dd className="tabular-nums font-medium">{pct}%</dd>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden>
        <div
          className="h-1.5 rounded-full bg-emerald-500"
          style={{ width: `${pct}%` }}
          data-testid={`factor-bar-${label.toLowerCase().replace(/\s+/g, '-')}`}
        />
      </div>
    </div>
  );
}

function InsufficientDataBody({
  daysOfHistory,
  totalCalls,
  reason,
}: {
  daysOfHistory: number | null;
  totalCalls: number;
  reason: ServerHealth['insufficient_data_reason'];
}): React.ReactElement {
  const daysValue = daysOfHistory ?? 0;
  const body = t(copy.detail.insufficient.body, {
    days: daysValue,
    days_label:
      daysValue === 1 ? copy.detail.insufficient.dayOne : copy.detail.insufficient.dayMany,
    calls: totalCalls,
    calls_label:
      totalCalls === 1 ? copy.detail.insufficient.callOne : copy.detail.insufficient.callMany,
  });
  const hint =
    reason === 'too_few_calls'
      ? copy.detail.insufficient.reasonFewCalls
      : copy.detail.insufficient.reasonRecent;

  return (
    <div data-testid="insufficient-data">
      <div className="text-base font-medium">{copy.detail.insufficient.title}</div>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function colorForScore(score: number): string {
  if (score >= 70) return 'text-emerald-600';
  if (score >= 40) return 'text-amber-600';
  return 'text-rose-600';
}
