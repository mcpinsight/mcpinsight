import { Link, useParams } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import type * as React from 'react';

import type { ServerHealth } from '@mcpinsight/core/types';

import { ApiError } from '@/api/client';
import { useHealthScore } from '@/api/hooks/use-health-score';
import { useServer } from '@/api/hooks/use-server';
import { CallsTimeseriesChart } from '@/components/shared/CallsTimeseriesChart';
import { HealthCard } from '@/components/shared/HealthCard';
import { ErrorState, Loading } from '@/components/shared/States';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { copy } from '@/copy/en';
import { formatInt, t } from '@/util/format';

const WINDOW_DAYS = 7;

export function ServerDetailRoute() {
  const { name } = useParams({ from: '/servers/$name' });
  const detail = useServer(name, WINDOW_DAYS);
  const health = useHealthScore(name);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {copy.detail.back}
      </Link>

      <div className="mt-6">
        {detail.isLoading && <Loading label={copy.detail.loading} />}
        {detail.isError && (
          <DetailError error={detail.error} name={name} refetch={() => void detail.refetch()} />
        )}
        {detail.data && <DetailBody name={name} detail={detail.data} health={health.data} />}
      </div>
    </div>
  );
}

function DetailBody({
  name,
  detail,
  health,
}: {
  name: string;
  detail: import('@/api/client').ServerDetailResponse;
  health: ServerHealth | undefined;
}): React.ReactElement {
  const subtitle = t(copy.detail.subtitle, {
    calls: formatInt(detail.summary.calls),
    unique_tools: formatInt(detail.summary.unique_tools),
    days: WINDOW_DAYS,
  });

  const firstPoint = detail.timeseries[0];
  const lastPoint = detail.timeseries.at(-1);
  const daysOfHistory =
    firstPoint && lastPoint ? Math.max(1, daysBetween(firstPoint.day, lastPoint.day)) : null;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <HealthCard
          health={health}
          daysOfHistory={daysOfHistory}
          totalCalls={detail.summary.calls}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="uppercase text-xs">{copy.detail.chartTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <CallsTimeseriesChart points={detail.timeseries} />
          </CardContent>
        </Card>
      </div>

      <section className="mt-8">
        <h2 className="text-base font-medium">{copy.detail.summaryTitle}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-y-2 rounded-md border p-4 text-sm md:grid-cols-2 md:gap-x-8">
          <SummaryRow label={copy.detail.labels.calls} value={formatInt(detail.summary.calls)} />
          <SummaryRow label={copy.detail.labels.errors} value={formatInt(detail.summary.errors)} />
          <SummaryRow
            label={copy.detail.labels.unique_tools}
            value={formatInt(detail.summary.unique_tools)}
          />
          <SummaryRow
            label={copy.detail.labels.input_tokens}
            value={formatInt(detail.summary.input_tokens)}
          />
          <SummaryRow
            label={copy.detail.labels.output_tokens}
            value={formatInt(detail.summary.output_tokens)}
          />
          <SummaryRow
            label={copy.detail.labels.cache_read_tokens}
            value={formatInt(detail.summary.cache_read_tokens)}
          />
        </dl>
      </section>

      {detail.tools.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-medium">{copy.detail.toolsTitle}</h2>
          <ul
            className="mt-3 flex flex-wrap gap-2"
            data-testid="tools-list"
            aria-label={copy.detail.toolsTitle}
          >
            {detail.tools.map((tool) => (
              <li
                key={tool}
                className="rounded-full border bg-muted/40 px-3 py-1 text-xs tabular-nums"
              >
                {tool}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-8">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function DetailError({
  error,
  name,
  refetch,
}: {
  error: unknown;
  name: string;
  refetch: () => void;
}) {
  if (error instanceof ApiError && error.status === 404) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <div className="text-base font-medium">{copy.detail.notFound.title}</div>
          <p className="text-sm text-muted-foreground">
            {t(copy.detail.notFound.body, { name, days: WINDOW_DAYS })}
          </p>
          <Link to="/" className="text-sm underline-offset-4 hover:underline">
            {copy.detail.back}
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <ErrorState
      title={copy.detail.error.title}
      hint={copy.detail.error.hint}
      retryLabel={copy.detail.error.retry}
      onRetry={refetch}
    />
  );
}

function daysBetween(firstIso: string, lastIso: string): number {
  const first = Date.parse(firstIso);
  const last = Date.parse(lastIso);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 0;
  return Math.round((last - first) / 86_400_000) + 1;
}
