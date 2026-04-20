import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copy } from '@/copy/en';

/**
 * Day 20 affordance: scan trigger on the dashboard ships Day 22 (see
 * `docs/api-contract.md` + Day 19 journal L4). We render the button DISABLED
 * wrapped in a tooltip so users know the feature is coming and where to run
 * the CLI in the meantime. The `<span>` wrapper around the disabled button
 * is required so the tooltip receives pointer events — a `disabled` button
 * doesn't fire them.
 */
export function ScanButton(): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block">
          <Button variant="outline" size="sm" disabled aria-disabled="true">
            {copy.overview.scanButton}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{copy.overview.scanTooltip}</TooltipContent>
    </Tooltip>
  );
}
