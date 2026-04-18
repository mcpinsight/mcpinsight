import { SELF_REFERENCE_SERVERS } from '../aggregator/self-reference.js';
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
  getScanState(filePath: string): ScanStateRow | null;
  upsertScanState(row: ScanStateRow): void;
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

    getScanState(filePath) {
      const row = getScanStateStmt.get(filePath) as ScanStateRow | undefined;
      return row ?? null;
    },

    upsertScanState(row) {
      upsertScanStateStmt.run(row);
    },
  };
}
