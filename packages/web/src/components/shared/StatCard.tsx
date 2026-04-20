import type * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/util/cn';

export function StatCard({
  title,
  value,
  subline,
  className,
}: {
  title: string;
  value: React.ReactNode;
  subline?: string;
  className?: string;
}): React.ReactElement {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="uppercase text-xs">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn('text-3xl font-semibold tabular-nums text-foreground')}>{value}</div>
        {subline !== undefined && (
          <div className="mt-1 text-xs text-muted-foreground">{subline}</div>
        )}
      </CardContent>
    </Card>
  );
}
