import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copy } from '@/copy/en';
import { cn } from '@/util/cn';
import { t } from '@/util/format';

/**
 * Color thresholds live here (not in Tailwind) because they are the
 * product-facing definition of "healthy/warning/critical", not styling.
 *
 * > 70   → green   (healthy)
 * 40-70  → amber   (warning)
 * < 40   → red     (critical)
 * null   → grey    (insufficient data)
 */
export const HEALTH_THRESHOLDS = {
  healthy: 70,
  warning: 40,
} as const;

export interface HealthBadgeProps {
  score: number | null;
  isEssential?: boolean;
  className?: string;
}

export function HealthBadge({
  score,
  isEssential,
  className,
}: HealthBadgeProps): React.ReactElement {
  const variant = classify(score);
  const label = score === null ? copy.overview.healthPlaceholder : score.toString();
  const tooltip = tooltipFor(score, isEssential);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', className)}>
          <Badge
            variant="secondary"
            data-testid="health-badge"
            data-variant={variant}
            aria-label={tooltip}
            className={cn('tabular-nums', badgeClass(variant))}
          >
            {label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

type HealthVariant = 'healthy' | 'warning' | 'critical' | 'unknown';

function classify(score: number | null): HealthVariant {
  if (score === null) return 'unknown';
  if (score >= HEALTH_THRESHOLDS.healthy) return 'healthy';
  if (score >= HEALTH_THRESHOLDS.warning) return 'warning';
  return 'critical';
}

function badgeClass(variant: HealthVariant): string {
  switch (variant) {
    case 'healthy':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100';
    case 'warning':
      return 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100';
    case 'critical':
      return 'bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100';
    case 'unknown':
      return '';
  }
}

function tooltipFor(score: number | null, isEssential?: boolean): string {
  if (score === null) return copy.overview.healthTooltipUnknown;
  const template = isEssential
    ? copy.overview.healthTooltipEssential
    : copy.overview.healthTooltipScore;
  return t(template, { score });
}
