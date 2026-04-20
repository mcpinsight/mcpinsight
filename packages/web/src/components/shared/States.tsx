import { AlertTriangle } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/util/cn';

export function Loading({
  label,
  className,
}: { label: string; className?: string }): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center p-12 text-sm text-muted-foreground',
        className,
      )}
    >
      {label}
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number } = {}): React.ReactElement {
  return (
    <div className="space-y-3" data-testid="table-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no identity
          key={i}
          className="h-10 w-full animate-pulse rounded-sm bg-muted"
        />
      ))}
    </div>
  );
}

export function ErrorState({
  title,
  hint,
  retryLabel,
  onRetry,
}: {
  title: string;
  hint: string;
  retryLabel: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          {title}
        </div>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint: string;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-12 text-center">
        <div className="text-base font-medium">{title}</div>
        <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
