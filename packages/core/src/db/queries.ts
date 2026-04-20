import { SELF_REFERENCE_SERVERS } from '../aggregator/self-reference.js';
import type { ServerHealthInputs } from '../health/score.js';
import type { Client, McpCall, ServerStatDaily } from '../types/canonical.js';
import type { Database } from './connection.js';

/**
 * One row of the `top` CLI / dashboard ranking.
 *
 * Sourced from `mcp_calls` (not `server_stats_daily`) because a cross-day
 * query needs `COUNT(DISTINCT tool_name)` on the raw rows — summing per-day
 * `unique_tools` would double-count tools that appear on multiple days.
 */
export interface TopServerRow {
  server_name: string;
  calls: number;
  errors: number;
  unique_tools: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd_real: number;
  cost_usd_est: number;
}

export interface ScanStateRow {
  file_path: string;
  last_byte_offset: number;
  last_scanned_at: number;
  client: string;
}

/**
 * One row of the `servers` CLI listing — a per-server activity overview.
 *
 * `last_activity_ms` is the most recent `ts` across all clients for this
 * server; `calls_in_window` is the count of calls within the supplied window
 * (used by `--zombies` to show servers with 0 calls in N days). Self-reference
 * servers are excluded (INV-04).
 */
export interface ServerListRow {
  server_name: string;
  last_activity_ms: number;
  calls_in_window: number;
  total_calls: number;
  /** Comma-separated distinct client ids, alphabetized. */
  clients: string;
}

/**
 * One row of the `clients` CLI listing — per-client activity breakdown.
 *
 * Rows reflect calls within a trailing window (`days`); self-reference servers
 * are excluded so a single self-hosted mcpinsight server doesn't inflate the
 * Claude Code count (INV-04). `first_ts` / `last_ts` are unix-ms boundaries
 * of observed activity within the same window — `null` if the client has no
 * calls in window (currently never returned; groups with zero calls are
 * dropped by `GROUP BY client`).
 */
export interface ClientListRow {
  client: string;
  calls: number;
  servers: number;
  first_ts: number;
  last_ts: number;
}

/** One day's roll-up for the detail-route timeseries chart. */
export interface TimeseriesRow {
  day: string;
  calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
}

/** Result of `getServerDetail` — all data the detail endpoint needs in one pass. */
export interface ServerDetailResult {
  summary: TopServerRow | null;
  timeseries: ReadonlyArray<TimeseriesRow>;
  tools: ReadonlyArray<string>;
}

export interface Queries {
  insertCall(call: McpCall): void;
  upsertServerStatDaily(row: ServerStatDaily): void;
  recomputeUniqueTools(args: {
    day: string;
    client: Client;
    server_name: string;
    project_identity: string;
    day_start_ms: number;
    day_end_ms: number;
  }): void;
  topServers(opts: { sinceMs: number; client: Client | null; limit: number }): TopServerRow[];
  listServers(opts: { windowSinceMs: number }): ServerListRow[];
  listClients(opts: { sinceMs: number }): ClientListRow[];
  countCallsByClient(client: Client): number;
  getScanState(filePath: string): ScanStateRow | null;
  upsertScanState(row: ScanStateRow): void;
  /**
   * Per-server detail: aggregate summary + daily timeseries + distinct tool list,
   * all filtered to the same (sinceMs, client) window. Returns `summary: null`
   * when no calls hit the window so the caller can raise a `NotFoundError`.
   */
  getServerDetail(opts: {
    name: string;
    sinceMs: number;
    client: Client | null;
  }): ServerDetailResult;
  /**
   * Everything `computeHealthScore` needs, in one round-trip. Respects INV-04
   * (self-reference is excluded from user-level counts).
   */
  healthInputs(opts: {
    server_name: string;
    sinceMs: number;
    client: Client | null;
  }): ServerHealthInputs;
}

export function createQueries(db: Database): Queries {
  const insertCall = db.prepare(`
    INSERT INTO mcp_calls (
      client, session_id, project_identity, server_name, tool_name, ts,
      input_tokens, output_tokens, cache_read_tokens, cost_usd, cost_is_estimated,
      is_error, duration_ms
    ) VALUES (
      @client, @session_id, @project_identity, @server_name, @tool_name, @ts,
      @input_tokens, @output_tokens, @cache_read_tokens, @cost_usd, @cost_is_estimated,
      @is_error, @duration_ms
    )
  `);

  const upsertStatsDaily = db.prepare(`
    INSERT INTO server_stats_daily (
      day, client, server_name, project_identity,
      calls, errors, unique_tools,
      input_tokens, output_tokens, cache_read_tokens,
      cost_usd_real, cost_usd_est
    ) VALUES (
      @day, @client, @server_name, @project_identity,
      @calls, @errors, @unique_tools,
      @input_tokens, @output_tokens, @cache_read_tokens,
      @cost_usd_real, @cost_usd_est
    )
    ON CONFLICT (day, client, server_name, project_identity) DO UPDATE SET
      calls             = calls             + excluded.calls,
      errors            = errors            + excluded.errors,
      input_tokens      = input_tokens      + excluded.input_tokens,
      output_tokens     = output_tokens     + excluded.output_tokens,
      cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
      cost_usd_real     = cost_usd_real     + excluded.cost_usd_real,
      cost_usd_est      = cost_usd_est      + excluded.cost_usd_est
  `);

  const recomputeUniqueTools = db.prepare(`
    UPDATE server_stats_daily
       SET unique_tools = (
         SELECT COUNT(DISTINCT tool_name)
           FROM mcp_calls
          WHERE mcp_calls.client           = @client
            AND mcp_calls.server_name      = @server_name
            AND mcp_calls.project_identity = @project_identity
            AND mcp_calls.ts              >= @day_start_ms
            AND mcp_calls.ts              <  @day_end_ms
       )
     WHERE day              = @day
       AND client           = @client
       AND server_name      = @server_name
       AND project_identity = @project_identity
  `);

  // INV-04: self-reference exclusion is embedded in the query, not deferred to
  // a caller-side filter. Names are hardcoded (constant set), so inlining is
  // safe from SQL injection and avoids a second round-trip to assemble a
  // temporary VALUES table.
  const selfRefList = [...SELF_REFERENCE_SERVERS]
    .map((s) => `'${s.replace(/'/g, "''")}'`)
    .join(', ');
  const topServers = db.prepare(`
    SELECT
      server_name,
      COUNT(*) AS calls,
      SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS errors,
      COUNT(DISTINCT tool_name) AS unique_tools,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(CASE WHEN cost_is_estimated = 0 THEN cost_usd ELSE 0 END), 0) AS cost_usd_real,
      COALESCE(SUM(CASE WHEN cost_is_estimated = 1 THEN cost_usd ELSE 0 END), 0) AS cost_usd_est
    FROM mcp_calls
    WHERE ts >= @since_ms
      AND (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
    GROUP BY server_name
    ORDER BY calls DESC
    LIMIT @limit
  `);

  const listServers = db.prepare(`
    SELECT
      server_name,
      MAX(ts) AS last_activity_ms,
      SUM(CASE WHEN ts >= @window_since_ms THEN 1 ELSE 0 END) AS calls_in_window,
      COUNT(*) AS total_calls,
      GROUP_CONCAT(DISTINCT client) AS clients
    FROM mcp_calls
    WHERE server_name NOT IN (${selfRefList})
    GROUP BY server_name
    ORDER BY last_activity_ms DESC
  `);

  // INV-04 again: self-reference excluded so the mcpinsight MCP server (when
  // used) doesn't dominate the Claude Code row and distort activity signal.
  const listClients = db.prepare(`
    SELECT
      client,
      COUNT(*) AS calls,
      COUNT(DISTINCT server_name) AS servers,
      MIN(ts) AS first_ts,
      MAX(ts) AS last_ts
    FROM mcp_calls
    WHERE ts >= @since_ms
      AND server_name NOT IN (${selfRefList})
    GROUP BY client
    ORDER BY calls DESC
  `);

  // Unfiltered — used by `scan` for the summary line. Self-reference IS
  // included here because the summary reports physical rows ingested; the
  // INV-04 exclusion only applies to ranking/aggregation queries.
  const countCallsByClient = db.prepare(`
    SELECT COUNT(*) AS n FROM mcp_calls WHERE client = ?
  `);

  const getScanStateStmt = db.prepare(`
    SELECT file_path, last_byte_offset, last_scanned_at, client
      FROM scan_state
     WHERE file_path = ?
  `);

  const upsertScanStateStmt = db.prepare(`
    INSERT INTO scan_state (file_path, last_byte_offset, last_scanned_at, client)
    VALUES (@file_path, @last_byte_offset, @last_scanned_at, @client)
    ON CONFLICT (file_path) DO UPDATE SET
      last_byte_offset = excluded.last_byte_offset,
      last_scanned_at  = excluded.last_scanned_at,
      client           = excluded.client
  `);

  // Detail summary — one row for the named server in window, `null` if no match.
  // INV-04: self-reference never appears here either (mirrors topServers). We
  // don't exclude it in the WHERE because a caller-supplied name can't be a
  // self-reference (filtered at list-time), but keep the guard for defensive
  // consistency.
  const detailSummaryStmt = db.prepare(`
    SELECT
      server_name,
      COUNT(*) AS calls,
      SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS errors,
      COUNT(DISTINCT tool_name) AS unique_tools,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(CASE WHEN cost_is_estimated = 0 THEN cost_usd ELSE 0 END), 0) AS cost_usd_real,
      COALESCE(SUM(CASE WHEN cost_is_estimated = 1 THEN cost_usd ELSE 0 END), 0) AS cost_usd_est
    FROM mcp_calls
    WHERE server_name = @server_name
      AND ts >= @since_ms
      AND (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
    GROUP BY server_name
  `);

  // Per-day roll-up for the chart. Day grouping is on UTC (ts in unix ms). The
  // 86_400_000 divisor avoids SQLite's strftime/unixepoch arithmetic (which
  // operates on seconds not ms) — integer division + printf keeps it explicit.
  const detailTimeseriesStmt = db.prepare(`
    SELECT
      strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day,
      COUNT(*) AS calls,
      SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS errors,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens
    FROM mcp_calls
    WHERE server_name = @server_name
      AND ts >= @since_ms
      AND (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
    GROUP BY day
    ORDER BY day ASC
  `);

  const detailToolsStmt = db.prepare(`
    SELECT DISTINCT tool_name
    FROM mcp_calls
    WHERE server_name = @server_name
      AND ts >= @since_ms
      AND (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
    ORDER BY tool_name ASC
  `);

  // User-level aggregate for the insufficient-data check. Self-reference is
  // excluded so a Week-4+ MCPInsight mcp-server can't inflate the user's
  // total_calls and bypass the threshold with hollow signal.
  const healthUserTotalsStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_calls,
      MIN(ts) AS earliest_ts
    FROM mcp_calls
    WHERE (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
  `);

  // Windowed per-server metrics feeding the Health Score components.
  const healthServerWindowStmt = db.prepare(`
    SELECT
      COUNT(*) AS calls,
      SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN is_error IS NOT NULL THEN 1 ELSE 0 END) AS scored_calls,
      COALESCE(SUM(output_tokens), 0) AS output_tokens
    FROM mcp_calls
    WHERE server_name = @server_name
      AND ts >= @since_ms
      AND (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
  `);

  const healthToolsStmt = db.prepare(`
    SELECT DISTINCT tool_name
    FROM mcp_calls
    WHERE server_name = @server_name
      AND ts >= @since_ms
      AND (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
    ORDER BY tool_name ASC
  `);

  // Project counts are taken over the full history (ADR-0004 §Essential-server
  // definition). Windowing is_essential would let a single week of low activity
  // flip a genuinely cross-project server out of the floor.
  const healthServerProjectsStmt = db.prepare(`
    SELECT COUNT(DISTINCT project_identity) AS n
    FROM mcp_calls
    WHERE server_name = @server_name
      AND (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
  `);

  const healthUserProjectsStmt = db.prepare(`
    SELECT COUNT(DISTINCT project_identity) AS n
    FROM mcp_calls
    WHERE (@client IS NULL OR client = @client)
      AND server_name NOT IN (${selfRefList})
  `);

  return {
    insertCall(call) {
      insertCall.run({
        client: call.client,
        session_id: call.session_id,
        project_identity: call.project_identity,
        server_name: call.server_name,
        tool_name: call.tool_name,
        ts: call.ts,
        input_tokens: call.input_tokens,
        output_tokens: call.output_tokens,
        cache_read_tokens: call.cache_read_tokens,
        cost_usd: call.cost_usd,
        cost_is_estimated: call.cost_is_estimated,
        is_error: call.is_error === null ? null : call.is_error ? 1 : 0,
        duration_ms: call.duration_ms,
      });
    },

    upsertServerStatDaily(row) {
      upsertStatsDaily.run({
        day: row.day,
        client: row.client,
        server_name: row.server_name,
        project_identity: row.project_identity,
        calls: row.calls,
        errors: row.errors,
        unique_tools: row.unique_tools,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_tokens: row.cache_read_tokens,
        cost_usd_real: row.cost_usd_real,
        cost_usd_est: row.cost_usd_est,
      });
    },

    recomputeUniqueTools(args) {
      recomputeUniqueTools.run(args);
    },

    topServers({ sinceMs, client, limit }) {
      return topServers.all({ since_ms: sinceMs, client, limit }) as TopServerRow[];
    },

    listServers({ windowSinceMs }) {
      const rows = listServers.all({ window_since_ms: windowSinceMs }) as Array<{
        server_name: string;
        last_activity_ms: number;
        calls_in_window: number;
        total_calls: number;
        clients: string | null;
      }>;
      return rows.map((r) => ({
        server_name: r.server_name,
        last_activity_ms: r.last_activity_ms,
        calls_in_window: r.calls_in_window,
        total_calls: r.total_calls,
        clients: (r.clients ?? '')
          .split(',')
          .filter((c) => c.length > 0)
          .sort()
          .join(','),
      }));
    },

    listClients({ sinceMs }) {
      return listClients.all({ since_ms: sinceMs }) as ClientListRow[];
    },

    countCallsByClient(client) {
      const row = countCallsByClient.get(client) as { n: number } | undefined;
      return row?.n ?? 0;
    },

    getScanState(filePath) {
      const row = getScanStateStmt.get(filePath) as ScanStateRow | undefined;
      return row ?? null;
    },

    upsertScanState(row) {
      upsertScanStateStmt.run(row);
    },

    getServerDetail({ name, sinceMs, client }) {
      const params = { server_name: name, since_ms: sinceMs, client };
      const summaryRow = detailSummaryStmt.get(params) as TopServerRow | undefined;
      const timeseries = detailTimeseriesStmt.all(params) as TimeseriesRow[];
      const toolsRows = detailToolsStmt.all(params) as Array<{ tool_name: string }>;
      return {
        summary: summaryRow ?? null,
        timeseries,
        tools: toolsRows.map((r) => r.tool_name),
      };
    },

    healthInputs({ server_name, sinceMs, client }) {
      const windowParams = { server_name, since_ms: sinceMs, client };
      const userParams = { client };
      const serverParams = { server_name, client };

      const userTotals = healthUserTotalsStmt.get(userParams) as {
        total_calls: number;
        earliest_ts: number | null;
      };
      const window = healthServerWindowStmt.get(windowParams) as {
        calls: number;
        errors: number;
        scored_calls: number;
        output_tokens: number;
      };
      const tools = (healthToolsStmt.all(windowParams) as Array<{ tool_name: string }>).map(
        (r) => r.tool_name,
      );
      const serverProjects = healthServerProjectsStmt.get(serverParams) as { n: number };
      const userProjects = healthUserProjectsStmt.get(userParams) as { n: number };

      return {
        server_name,
        total_calls_all_servers: userTotals.total_calls,
        earliest_ts_ms: userTotals.earliest_ts,
        calls_30d: window.calls,
        errors_30d: window.errors,
        scored_calls_30d: window.scored_calls,
        output_tokens_30d: window.output_tokens,
        tools_30d: tools,
        server_project_count: serverProjects.n,
        user_project_count: userProjects.n,
      };
    },
  };
}
