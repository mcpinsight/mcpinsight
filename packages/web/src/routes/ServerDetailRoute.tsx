import { Link, useParams } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import type * as React from 'react';

import type { TopServerRow } from '@mcpinsight/core';

import { ApiError } from '@/api/client';
import { useServer } from '@/api/hooks/use-server';
import { ErrorState, Loading } from '@/components/shared/States';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { copy } from '@/copy/en';
import { formatInt, t } from '@/util/format';

const WINDOW_DAYS = 7;

export function ServerDetailRoute() {
  const { name } = useParams({ from: '/servers/$name' });
  const query = useServer(name, WINDOW_DAYS);

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
        {query.isLoading && <Loading label={copy.detail.loading} />}
        {query.isError && (
          <DetailError error={query.error} name={name} refetch={() => void query.refetch()} />
        )}
        {query.data && <DetailBody name={name} summary={query.data.summary} />}
      </div>
    </div>
  );
}

function DetailBody({ name, summary }: { name: string; summary: TopServerRow }) {
  const subtitle = t(copy.detail.subtitle, {
    calls: formatInt(summary.calls),
    unique_tools: formatInt(summary.unique_tools),
    days: WINDOW_DAYS,
  });

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="uppercase text-xs">{copy.detail.healthTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-semibold tabular-nums">—</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {copy.detail.healthPlaceholder}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="uppercase text-xs">{copy.detail.chartTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="flex h-48 w-full items-center justify-center rounded-md bg-muted/40 text-sm text-muted-foreground"
              aria-label={copy.detail.chartPlaceholder}
            >
              {copy.detail.chartPlaceholder}
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="mt-8">
        <h2 className="text-base font-medium">{copy.detail.summaryTitle}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-y-2 rounded-md border p-4 text-sm md:grid-cols-2 md:gap-x-8">
          <SummaryRow label={copy.detail.labels.calls} value={formatInt(summary.calls)} />
          <SummaryRow label={copy.detail.labels.errors} value={formatInt(summary.errors)} />
          <SummaryRow
            label={copy.detail.labels.unique_tools}
            value={formatInt(summary.unique_tools)}
          />
          <SummaryRow
            label={copy.detail.labels.input_tokens}
            value={formatInt(summary.input_tokens)}
          />
          <SummaryRow
            label={copy.detail.labels.output_tokens}
            value={formatInt(summary.output_tokens)}
          />
          <SummaryRow
            label={copy.detail.labels.cache_read_tokens}
            value={formatInt(summary.cache_read_tokens)}
          />
        </dl>
      </section>
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
