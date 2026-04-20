import type * as React from 'react';

import { CLIENT_IDS } from '@mcpinsight/core/types';
import type { Client } from '@mcpinsight/core/types';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { copy } from '@/copy/en';

export type ClientFilterValue = Client | 'all';

export function ClientFilter({
  value,
  onChange,
}: {
  value: ClientFilterValue;
  onChange: (next: ClientFilterValue) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{copy.overview.filterLabel}</span>
      <Select value={value} onValueChange={(next) => onChange(next as ClientFilterValue)}>
        <SelectTrigger className="w-56" aria-label="Client filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{copy.overview.filterAll}</SelectItem>
          {CLIENT_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
