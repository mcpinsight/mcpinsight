# Skill: Frontend (React 18 + Vite + Tailwind + shadcn)

> Load when touching `packages/web/`.

## Stack

- **React 18** with the new JSX transform. No class components.
- **Vite 5**, TypeScript strict.
- **TanStack Router** (file-based routing off; code-based is fine for our small surface).
- **TanStack Query v5** for server state.
- **Tailwind CSS 3** + **shadcn/ui** components (copy-in, not library).
- **lucide-react** icons.
- **No**: Redux, Zustand, Jotai, styled-components, emotion, react-hook-form. See `agents/architect.md`.

## Project layout (inside `packages/web/src/`)

```
src/
├── main.tsx                    # Entrypoint; mounts React, Router, Query providers
├── router.tsx                  # Route tree
├── api/
│   ├── client.ts               # typed fetch wrapper
│   └── hooks/                  # one hook per endpoint (useServers, useServer, etc.)
├── components/
│   ├── ui/                     # shadcn copies (button.tsx, card.tsx, table.tsx, ...)
│   └── shared/                 # project-specific: StatCard, HealthBadge, ServerTable
├── routes/
│   ├── OverviewRoute.tsx
│   ├── ServerDetailRoute.tsx
│   └── SettingsRoute.tsx
├── copy/
│   └── en.ts                   # all user-facing strings
├── styles/
│   ├── tokens.css              # CSS vars consumed by Tailwind config
│   └── globals.css             # reset + font imports
└── util/
    └── format.ts               # formatNumber, formatDate, formatDuration
```

## Best practices

### Typed fetch wrapper

```ts
// src/api/client.ts
import type { ServerSummary, ServerDetail } from '@mcpinsight/core/types';

const BASE = import.meta.env.VITE_API_BASE ?? '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Accept': 'application/json', ...init?.headers } });
  if (!res.ok) throw new ApiError(res.status, await safeText(res));
  return res.json() as Promise<T>;
}

export const api = {
  servers: (params?: { client?: string; days?: number }) =>
    req<ServerSummary[]>(`/api/servers${qs(params)}`),
  server: (name: string) =>
    req<ServerDetail>(`/api/servers/${encodeURIComponent(name)}`),
};
```

### Hook per endpoint

```ts
// src/api/hooks/use-servers.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export function useServers(params?: { client?: string; days?: number }) {
  return useQuery({
    queryKey: ['servers', params ?? {}],
    queryFn: () => api.servers(params),
  });
}
```

Components never call `useQuery` directly.

### Component pattern

```tsx
// src/routes/OverviewRoute.tsx
import { useServers } from '@/api/hooks/use-servers';
import { copy } from '@/copy/en';
import { ServerTable } from '@/components/shared/ServerTable';
import { Loading, ErrorState, EmptyState } from '@/components/shared/States';

export function OverviewRoute() {
  const { data, isLoading, isError } = useServers({ days: 7 });
  if (isLoading) return <Loading label={copy.overview.loading} />;
  if (isError) return <ErrorState />;
  if (!data?.length) return <EmptyState title={copy.overview.empty.title} hint={copy.overview.empty.hint} />;
  return (
    <div className="p-6 space-y-6">
      <Header />
      <ServerTable servers={data} />
    </div>
  );
}
```

Four states handled. Copy from `copy/en.ts`. Hook does the fetching.

### Copy centralization

```ts
// src/copy/en.ts
export const copy = {
  overview: {
    title: 'Your MCP Servers',
    loading: 'Reading your sessions…',
    empty: {
      title: 'No MCP calls found yet',
      hint: 'Run `mcpinsight scan` or start a session that uses MCP tools.',
    },
  },
  telemetryModal: {
    headline: 'Help build the first State of MCP ranking',
    body: 'Your data stays anonymous — we collect server names and call counts, never content.',
    primaryCta: 'Join {{count}} developers →',
    secondaryCta: 'Maybe later',
  },
} as const;
```

Interpolation: a tiny `t(template, vars)` helper in `util/format.ts`. Don't reach for i18next.

### shadcn discipline

- Components under `components/ui/` are shadcn copies. Only edit to add **variants** via `class-variance-authority`.
- If a design needs a new button style, add a variant; never create `PrimaryButton.tsx`.
- Upgrades: shadcn gives you code, so upgrades are manual diffs. OK for our scope.

### Tailwind token bridge

```css
/* src/styles/tokens.css */
:root {
  --bg: theme('colors.zinc.50');
  --fg: theme('colors.zinc.900');
  --muted: theme('colors.zinc.500');
  --brand: theme('colors.indigo.600');
  --success: theme('colors.emerald.600');
  --warning: theme('colors.amber.600');
  --danger: theme('colors.rose.600');
}
```

Component code uses `text-[color:var(--fg)]` or Tailwind classes directly. No hex in JSX.

## Anti-patterns

- **Prop drilling through 3+ components**: pass via context or refactor.
- **`useEffect` for derived state**: `useMemo` or just compute inline.
- **Fetch in `useEffect`**: always through TanStack Query.
- **CSS-in-JS libraries**: not needed; Tailwind + tokens cover 100%.
- **Custom hooks that only wrap one other hook**: inline it.
- **Date formatting with `toLocaleString` scattered**: centralize in `util/format.ts`.

## Performance

- **Bundle budget**: ≤200 KB gzipped for initial chunk. Measured in CI via `vite build` output.
- **Images**: none in the app (it's a dashboard); if we add a logo, it's an inline SVG.
- **Code split** per route via `React.lazy` if the app grows; unneeded at current scale.
- **Re-render discipline**: Chart components memoed; table rows keyed by stable ID.

## Accessibility

- Every interactive element is reachable by Tab; focus-visible ring is on.
- Every `<img>` has `alt`. Decorative images use `alt=""`.
- Forms use `<label>` or `aria-label`. No "placeholder as label".
- Color contrast: at least 4.5:1 for body, 3:1 for large text. Checked via `@tailwindcss/contrast` plugin + manual spot-checks.
- Modals trap focus and restore it on close.

## Testing

- Vitest + `@testing-library/react` for component tests. Smoke-level: renders, handles empty state, handles error state.
- **No snapshot tests** for user-visible UI.
- Playwright e2e covers the one critical path: first-run → scan → top servers visible.

## Claude hints

- Before adding a new component, search `components/` — someone may have made half of it.
- Before adding a hook, check `api/hooks/` — the endpoint may already be wrapped.
- When in doubt about state placement, ask: "who else needs this?" If only one component → local state.
