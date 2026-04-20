# Design: Overview page + Server Detail (Day 20 scaffold)

> Agent: UI Designer. Consumer: Frontend Engineer (`packages/web/`).
> Tokens: shadcn/ui defaults + zinc/slate neutral scale + one brand accent.
> Reference: `docs/api-contract.md` v0.1 (Day 19 read-only surface).

## 1. Overview (`/`)

The local dashboard's first screen — lands here after `mcpinsight serve`.
Populated from `GET /api/servers?days=7` + `GET /api/clients?days=30`.

### 1.1 Layout (top → bottom)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Your MCP Servers                                  [▸ Scan now (disabled)]│  <- header row
│ last 7 days · across claude-code + codex                                 │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                  │
│  │ TOTAL CALLS  │   │ SERVERS      │   │ CLIENTS      │                  │
│  │   1,204      │   │      8       │   │ claude-code  │                  │
│  │   7d         │   │ active       │   │ codex        │                  │
│  └──────────────┘   └──────────────┘   └──────────────┘                  │  <- stat row (3 cards)
├──────────────────────────────────────────────────────────────────────────┤
│  Filter: [client: all ▾]                                                 │  <- filter row
├──────────────────────────────────────────────────────────────────────────┤
│  SERVER                 CALLS   TOOLS   SUCCESS   TOKENS      HEALTH     │
│  ──────────────────────────────────────────────────────────────────────  │
│  filesystem               412       4     99.3%    180,340        —      │
│  github                   308       2     94.1%     88,712        —      │
│  slack mcp                 96       3    100.0%     12,004        —      │
│  claude_ai_Google_Drive     3       2    100.0%     67,344        —      │
│  ...                                                                     │  <- data table
└──────────────────────────────────────────────────────────────────────────┘
```

Spacing:
- Page container: `max-w-6xl mx-auto px-6 py-8`.
- Header → stat row gap: `mt-8`.
- Stat row → filter row gap: `mt-8`.
- Filter row → table gap: `mt-4`.
- Stat cards equal width: `grid grid-cols-1 md:grid-cols-3 gap-4`.

### 1.2 Block-by-block

#### Header

- `<h1>` — `copy.overview.title` = `"Your MCP Servers"`.
  - Type: `text-2xl font-semibold tracking-tight`.
- Subline — `copy.overview.subtitle` = `"last {{days}} days · across {{clients}}"`.
  - Composed from `useClients` result; empty clients → omit the second clause.
  - Type: `text-sm text-muted-foreground mt-1`.
- Right-aligned **`<Button variant="outline" disabled>`** with `<Tooltip>` wrapper.
  - Label: `copy.overview.scanButton` = `"Scan now"`.
  - Tooltip content: `copy.overview.scanTooltip` = `"Dashboard trigger ships Day 22. Run \`mcpinsight scan\` from the CLI for now."`.
  - Rationale (per Day 19 carry-forward L4): affordance is present so the user
    knows it will arrive; not omitted — omitting it would make the dashboard
    feel incomplete forever.

#### Stat cards (`<Card>` ×3)

1. **Total calls (7d)** — `<Card>` with `CardHeader>CardTitle` = `"Total calls"`, `CardContent` = big number `text-3xl font-semibold tabular-nums`, subline `text-xs text-muted-foreground` = `"7d"`.
2. **Active servers** — count from table length; subline = `"active"`.
3. **Clients** — comma-joined client ids from `/api/clients`; `text-sm tabular-nums` list.

Empty-data state: "—" in the big-number slot; subline = `copy.overview.empty.hint`.

Drop the cost card in v0.1 — all our real-world data reports `cost_usd_real: 0`
(no user has a raw API key configured yet), so showing "$0.00" is misleading.
Revisit Day 22 polish.

#### Filter row

- `<Select>` (shadcn). Width `w-56`.
- Default selected: `"all"`. Options exactly match the `Client` enum:
  - `all` → show everything (no `client` param on the API call)
  - `claude-code`
  - `codex`
  - `cursor`
  - `windsurf`
  - `copilot`
- Label: inline `<span className="text-sm text-muted-foreground mr-2">Filter:</span>`.
- Copy key: `copy.overview.filterLabel` = `"Filter:"`.
- Copy key: `copy.overview.filterAll` = `"All clients"`.

Behavior: on change, the `useServers` hook re-queries with the new `client`
param. TanStack Query handles deduplication.

#### Table (`<Table>`)

Columns (left → right):
| Column   | Header       | Align | Source                                |
|----------|--------------|-------|---------------------------------------|
| Server   | SERVER       | left  | `row.server_name`                     |
| Calls    | CALLS        | right | `row.calls`                           |
| Tools    | TOOLS        | right | `row.unique_tools`                    |
| Success  | SUCCESS      | right | `(calls-errors)/calls * 100` (client) |
| Tokens   | TOKENS       | right | `input + output + cache_read`         |
| Health   | HEALTH SCORE | right | `"—"` placeholder                     |

- Header row: `text-xs uppercase text-muted-foreground tracking-wide`.
- Data rows: `text-sm tabular-nums`, row hover `hover:bg-muted/50`, `transition-colors`.
- Server name column: `font-medium text-foreground`.
- Success rate under 95% → `text-warning` (`text-amber-600`); under 80% → `text-danger` (`text-rose-600`).
- Health column: `<Badge variant="secondary">—</Badge>` with a `<Tooltip>`.
  - Tooltip copy: `copy.overview.healthTooltip` = `"Health Score ships Day 21."`.
  - Header tooltip same content on hover of `"HEALTH SCORE"` th.

Row click (future Day 21+): navigate to `/servers/:name`. For Day 20: the
server name is a `<Link>` styled as `underline-offset-4 hover:underline`.
Row click itself does nothing yet — keyboard-reachable via the link.

### 1.3 States

All four states required for the table component:

| State | Trigger | Rendered |
|---|---|---|
| **Loading** | `isLoading || isFetching` (first load only) | Skeleton: `<div>` with 4 rows of `animate-pulse` placeholder `<div className="h-4 w-full bg-muted rounded-sm">`. |
| **Error** | `isError` | `<Card>` with `<AlertTriangle>` icon, heading `copy.overview.error.title` = `"Couldn't load servers"`, body `copy.overview.error.hint` = `"Is `mcpinsight serve` running? Try reloading."`, button `"Retry"` → `refetch()`. |
| **Empty** | `data?.length === 0` | Center-aligned pitch: heading `copy.overview.empty.title` = `"No MCP calls yet"`, body `copy.overview.empty.hint` = `"Run `mcpinsight scan` to ingest your Claude Code and Codex sessions, then reload."`, optional secondary-style CTA label `copy.overview.empty.cta` = `"How to scan"` (no-op for Day 20, links to README on GitHub as a safe static target). |
| **Populated** | `data.length > 0` | Table per above. |

### 1.4 Copy keys (added to `packages/web/src/copy/en.ts`)

```ts
overview: {
  title: 'Your MCP Servers',
  subtitle: 'last {{days}} days{{clientsSuffix}}',      // clientsSuffix = " · across claude-code + codex" or ""
  scanButton: 'Scan now',
  scanTooltip: 'Dashboard trigger ships Day 22. Run `mcpinsight scan` from the CLI for now.',
  filterLabel: 'Filter:',
  filterAll: 'All clients',
  healthTooltip: 'Health Score ships Day 21.',
  statTotalCalls: 'Total calls',
  statServers: 'Active servers',
  statClients: 'Clients',
  empty: {
    title: 'No MCP calls yet',
    hint: 'Run `mcpinsight scan` to ingest your Claude Code and Codex sessions, then reload.',
    cta: 'How to scan',
  },
  error: {
    title: "Couldn't load servers",
    hint: 'Is `mcpinsight serve` running? Try reloading.',
    retry: 'Retry',
  },
}
```

### 1.5 Token / Tailwind references

- `bg-background` / `text-foreground` — page surface and body text (shadcn default — zinc-50 bg / zinc-900 fg, swapped in dark mode which we don't ship Y1).
- `text-muted-foreground` — subtitles and captions (zinc-500).
- `border-border` — table row divider + card edges (zinc-200).
- `bg-card` + `text-card-foreground` — stat cards (white).
- `bg-muted` — skeleton placeholders (zinc-100).
- `rounded-md` on cards and the table container; `rounded-sm` on inputs;
  `rounded-full` on the client pill (if we pill it; Select is fine too).
- Spacing atoms: 4 / 8 / 12 / 16 / 24 / 32. No custom values.
- Font: system stack; Inter optional (loaded via `@fontsource-variable/inter` or
  `<link>`); fallback is native macOS `-apple-system`. Decision: keep system for
  Day 20 — one fewer decision, one fewer bundle byte.

### 1.6 shadcn components used

- `Button` — disabled scan button, empty-state CTA, error retry.
- `Card`, `CardHeader`, `CardTitle`, `CardContent` — stat cards, error panel.
- `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` — server table.
- `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue` — client filter.
- `Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent` — scan button + health header + health row pills.
- `Badge` — the "—" health placeholder, variant="secondary".

No custom variants for Day 20.

---

## 2. Server Detail (`/servers/:name`) — placeholder

Day 21 populates this. Day 20 ships a skeleton so the route exists, the
component tree is in place, and the navigation from the overview table works.

### 2.1 Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Back to overview                                                       │
│                                                                          │
│ filesystem                                                               │
│ 412 calls · 4 unique tools · last 7 days                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────┐  ┌─────────────────────────────────┐           │
│ │ HEALTH SCORE          │  │ CALLS / DAY                     │           │
│ │   —                   │  │                                 │           │
│ │ Ships Day 21          │  │ (chart placeholder — Day 21)    │           │
│ └───────────────────────┘  └─────────────────────────────────┘           │
│                                                                          │
│  Summary                                                                 │
│  ─────────────────────────────────────                                   │
│  Calls              412                                                  │
│  Errors             3                                                    │
│  Unique tools       4                                                    │
│  Input tokens       88,500                                               │
│  Output tokens      91,840                                               │
│  Cache read tokens  0                                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Blocks

- **Back link** — `<Link to="/">` with `<ChevronLeft>` icon; copy `copy.detail.back = "Back to overview"`.
- **Heading** — `<h1 className="text-2xl font-semibold">{server_name}</h1>`.
  - Subline — `copy.detail.subtitle = "{{calls}} calls · {{unique_tools}} unique tools · last {{days}} days"`.
- **Health card** — `<Card>` with the big `"—"` number, subline = `copy.detail.healthPlaceholder = "Ships Day 21"`.
- **Timeseries slot** — `<Card>` with `<CardTitle>Calls / day</CardTitle>` and a
  `<div className="h-48 w-full bg-muted/40 rounded-md flex items-center justify-center text-sm text-muted-foreground">Chart coming Day 21</div>`.
  - Copy: `copy.detail.chartPlaceholder = "Chart coming Day 21"`.
- **Summary list** — `<dl>` with `dt/dd` pairs pulled from `summary` (the same
  `TopServerRow`-shaped object the contract returns in v0.1).

### 2.3 States

| State | Trigger | Rendered |
|---|---|---|
| Loading | `isLoading` | Heading skeleton (`h-8 w-64 bg-muted animate-pulse rounded-sm`) + two card skeletons |
| Error | `isError` (non-404) | Same error card pattern as overview with retry |
| 404 | API returns 404 | Friendly "Not found" card: copy `copy.detail.notFound.title = "Server not found"`, body `"No calls recorded for **{{name}}** in the last {{days}} days."`, back link. |
| Populated | 200 | Layout above. |

### 2.4 Copy keys

```ts
detail: {
  back: 'Back to overview',
  subtitle: '{{calls}} calls · {{unique_tools}} unique tools · last {{days}} days',
  healthTitle: 'Health Score',
  healthPlaceholder: 'Ships Day 21',
  chartTitle: 'Calls / day',
  chartPlaceholder: 'Chart coming Day 21',
  summaryTitle: 'Summary',
  labels: {
    calls: 'Calls',
    errors: 'Errors',
    unique_tools: 'Unique tools',
    input_tokens: 'Input tokens',
    output_tokens: 'Output tokens',
    cache_read_tokens: 'Cache read tokens',
  },
  notFound: {
    title: 'Server not found',
    body: 'No calls recorded for {{name}} in the last {{days}} days.',
  },
}
```

---

## 3. Handoff notes for Frontend

- **Do not redeclare** `TopServerRow` / `ClientListRow`. Import from
  `@mcpinsight/core`. The `Client` enum literal set lives there too — pull it
  from the core package and build the filter options off it rather than
  hardcoding in `copy/en.ts`.
- **501 is a placeholder, not an error.** `/api/health/:name` returns 501
  today — the Day 20 detail page does NOT render an error state for that
  endpoint. It simply doesn't call it; the `"—"` placeholder is static until
  Day 21.
- **Scan-now is disabled.** Not a "coming soon" button with onclick handler —
  the actual `disabled` attribute, wrapped in `<TooltipTrigger asChild>` so
  users can hover the disabled element and read the reason.
- **Success-rate coloring** is client-side derived; never sent from the API.
- **Token totals** sum `input + output + cache_read`. The cost fields stay out
  of the overview until a user with a raw API key (cost_is_estimated=0) shows
  up; displaying `$0.00` is actively misleading.
- **No dark mode.** Ship light-only per `ui-designer.md` §5.

## 4. Open questions for PM / Architect (non-blocking)

- Should the client filter be a Select or a row of pill toggles? Select scales
  better once we hit 5+ clients. Going with Select for Day 20; revisit if a
  user finds it unobvious.
- Server name click vs. row click: today the name is a link; row click as a
  whole could also be a link if we wrap `<tr>`. Deferred to Day 22 polish —
  need to verify keyboard reach doesn't break.
