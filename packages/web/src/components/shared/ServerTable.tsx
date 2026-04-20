import { Link } from '@tanstack/react-router';
import type * as React from 'react';

import type { TopServerRow } from '@mcpinsight/core';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copy } from '@/copy/en';
import { cn } from '@/util/cn';
import { computeSuccessRate, formatInt, formatSuccessRate, totalTokens } from '@/util/format';

export function ServerTable({ rows }: { rows: ReadonlyArray<TopServerRow> }): React.ReactElement {
  const headers = copy.overview.tableHeaders;
  return (
    <div className="rounded-md border" data-testid="server-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{headers.server}</TableHead>
            <TableHead className="text-right">{headers.calls}</TableHead>
            <TableHead className="text-right">{headers.tools}</TableHead>
            <TableHead className="text-right">{headers.success}</TableHead>
            <TableHead className="text-right">{headers.tokens}</TableHead>
            <TableHead className="text-right">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help underline-offset-4 decoration-dotted hover:underline">
                    {headers.health}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{copy.overview.healthTooltip}</TooltipContent>
              </Tooltip>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <ServerRow key={row.server_name} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ServerRow({ row }: { row: TopServerRow }): React.ReactElement {
  const successRate = computeSuccessRate(row.calls, row.errors);
  const successClass = successColor(successRate);
  return (
    <TableRow data-testid="server-row">
      <TableCell className="font-medium">
        <Link
          to="/servers/$name"
          params={{ name: row.server_name }}
          className="underline-offset-4 hover:underline"
        >
          {row.server_name}
        </Link>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatInt(row.calls)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatInt(row.unique_tools)}</TableCell>
      <TableCell className={cn('text-right tabular-nums', successClass)}>
        {formatSuccessRate(row.calls, row.errors)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatInt(totalTokens(row))}</TableCell>
      <TableCell className="text-right">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Badge variant="secondary" aria-label={copy.overview.healthTooltip}>
                {copy.overview.healthPlaceholder}
              </Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{copy.overview.healthTooltip}</TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

function successColor(rate: number | null): string {
  if (rate === null) return '';
  if (rate < 0.8) return 'text-destructive';
  if (rate < 0.95) return 'text-warning';
  return '';
}
