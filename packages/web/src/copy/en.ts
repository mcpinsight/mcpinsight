/**
 * All user-facing strings for the dashboard. INV-08: English-only in Y1; no
 * i18n framework. Interpolate via `util/format.ts :: t(template, vars)`.
 *
 * When adding a string:
 *   1. Add it here, nested under the screen or surface it belongs to.
 *   2. Reference it via `copy.<screen>.<key>` in the component.
 *   3. Never hardcode a string in JSX — it makes the eventual i18n pass
 *      painful and the copy review slow.
 */
export const copy = {
  appName: 'MCPInsight',
  overview: {
    title: 'Your MCP Servers',
    subtitleBase: 'last {{days}} days',
    subtitleClientsSuffix: ' · across {{clients}}',
    scanButton: 'Scan now',
    scanTooltip: 'Dashboard trigger ships Day 22. Run `mcpinsight scan` from the CLI for now.',
    filterLabel: 'Filter:',
    filterAll: 'All clients',
    healthHeader: 'Health Score',
    healthPlaceholder: '—',
    healthTooltipUnknown: 'Not enough data yet — run `mcpinsight scan` on more sessions.',
    healthTooltipScore:
      'Score {{score}} — activation 30% · success 30% · tool use 20% · clarity 10% · token efficiency 10%.',
    healthTooltipEssential:
      'Score {{score}} (essential to your work) — activation 30% · success 30% · tool use 20% · clarity 10% · token efficiency 10%.',
    statTotalCalls: 'Total calls',
    statServers: 'Active servers',
    statClients: 'Clients',
    tableHeaders: {
      server: 'SERVER',
      calls: 'CALLS',
      tools: 'TOOLS',
      success: 'SUCCESS',
      tokens: 'TOKENS',
      health: 'HEALTH SCORE',
    },
    empty: {
      title: 'No MCP calls yet',
      hint: 'Run `mcpinsight scan` to ingest your Claude Code and Codex sessions, then reload.',
    },
    error: {
      title: "Couldn't load servers",
      hint: 'Is `mcpinsight serve` running? Try reloading.',
      retry: 'Retry',
    },
    loading: 'Loading…',
  },
  detail: {
    back: 'Back to overview',
    subtitle: '{{calls}} calls · {{unique_tools}} unique tools · last {{days}} days',
    healthTitle: 'Health Score',
    healthEssentialBadge: 'Essential',
    healthOutOf: 'out of 100',
    healthFactors: {
      activation: 'Activation',
      successRate: 'Success rate',
      toolUtil: 'Tool use',
      clarity: 'Clarity',
      tokenEff: 'Token efficiency',
    },
    insufficient: {
      title: 'Not enough data yet',
      body: 'Health Score needs 14+ days of history and 50+ total calls. You have {{days}} {{days_label}} and {{calls}} {{calls_label}} so far.',
      dayOne: 'day',
      dayMany: 'days',
      callOne: 'call',
      callMany: 'calls',
      reasonRecent: 'Too early to score reliably — check back in a week.',
      reasonFewCalls: 'Run more sessions, then refresh.',
    },
    chartTitle: 'Calls / day',
    chartEmpty: 'No calls in the last 7 days.',
    summaryTitle: 'Summary',
    toolsTitle: 'Tools used',
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
    error: {
      title: "Couldn't load this server",
      hint: 'Is `mcpinsight serve` running? Try reloading.',
      retry: 'Retry',
    },
    loading: 'Loading server detail…',
  },
} as const;
