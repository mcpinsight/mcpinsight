/**
 * INV-04: the self-referential MCP server ("mcpinsight" — planned Week 4+)
 * is excluded from public rankings. Its calls still land in `mcp_calls` for
 * the user's personal view but never roll up into `server_stats_daily` or
 * appear in `topServers`. Hardcoded; unit-tested.
 */
export const SELF_REFERENCE_SERVERS: ReadonlySet<string> = new Set(['mcpinsight']);
