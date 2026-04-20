import { useState } from 'react';

import { useClients } from '@/api/hooks/use-clients';
import { useServers } from '@/api/hooks/use-servers';
import { ClientFilter, type ClientFilterValue } from '@/components/shared/ClientFilter';
import { ScanButton } from '@/components/shared/ScanButton';
import { ServerTable } from '@/components/shared/ServerTable';
import { StatCard } from '@/components/shared/StatCard';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/shared/States';
import { copy } from '@/copy/en';
import { formatInt, t } from '@/util/format';

const WINDOW_DAYS = 7;

export function OverviewRoute() {
  const [clientFilter, setClientFilter] = useState<ClientFilterValue>('all');

  const serversQuery = useServers({ client: clientFilter, days: WINDOW_DAYS });
  const clientsQuery = useClients(30);

  const totalCalls = (serversQuery.data ?? []).reduce((sum, row) => sum + row.calls, 0);
  const clientIdsActive = (clientsQuery.data ?? []).map((c) => c.client);
  const subtitle = buildSubtitle(WINDOW_DAYS, clientIdsActive);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{copy.overview.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <ScanButton />
      </header>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          title={copy.overview.statTotalCalls}
          value={formatInt(totalCalls)}
          subline={`${WINDOW_DAYS}d`}
        />
        <StatCard
          title={copy.overview.statServers}
          value={formatInt((serversQuery.data ?? []).length)}
          subline="active"
        />
        <StatCard
          title={copy.overview.statClients}
          value={
            clientIdsActive.length > 0 ? (
              <span className="text-lg font-medium leading-tight">
                {clientIdsActive.join(', ')}
              </span>
            ) : (
              '—'
            )
          }
        />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <ClientFilter value={clientFilter} onChange={setClientFilter} />
      </div>

      <div className="mt-4">
        <OverviewBody
          isLoading={serversQuery.isLoading}
          isError={serversQuery.isError}
          rows={serversQuery.data}
          onRetry={() => {
            void serversQuery.refetch();
          }}
        />
      </div>
    </div>
  );
}

function OverviewBody({
  isLoading,
  isError,
  rows,
  onRetry,
}: {
  isLoading: boolean;
  isError: boolean;
  rows: ReadonlyArray<import('@mcpinsight/core').TopServerRow> | undefined;
  onRetry: () => void;
}) {
  if (isLoading) return <TableSkeleton />;
  if (isError) {
    return (
      <ErrorState
        title={copy.overview.error.title}
        hint={copy.overview.error.hint}
        retryLabel={copy.overview.error.retry}
        onRetry={onRetry}
      />
    );
  }
  if (!rows || rows.length === 0) {
    return <EmptyState title={copy.overview.empty.title} hint={copy.overview.empty.hint} />;
  }
  return <ServerTable rows={rows} />;
}

function buildSubtitle(days: number, clientIds: ReadonlyArray<string>): string {
  const base = t(copy.overview.subtitleBase, { days });
  if (clientIds.length === 0) return base;
  const suffix = t(copy.overview.subtitleClientsSuffix, { clients: clientIds.join(' + ') });
  return base + suffix;
}
