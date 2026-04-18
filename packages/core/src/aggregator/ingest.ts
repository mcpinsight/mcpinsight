import type { Database } from '../db/connection.js';
import type { Queries } from '../db/queries.js';
import type { McpCall, ServerStatDaily } from '../types/canonical.js';
import { SELF_REFERENCE_SERVERS } from './self-reference.js';

export { SELF_REFERENCE_SERVERS };

export interface IngestStats {
  /** Total `mcp_calls` rows inserted this batch (includes self-reference). */
  inserted: number;
  /** How many rows hit the SELF_REFERENCE_SERVERS exclusion (INV-04). */
  selfReferenceExcluded: number;
  /** Distinct (day, client, server, project) keys touched in server_stats_daily. */
  dailyAggregatesAffected: number;
}

/**
 * Batch-ingest canonical McpCalls into SQLite.
 *
 * Pipeline (all inside a single `db.transaction` for atomicity):
 *   1. `INSERT` every row into `mcp_calls` (self-reference included per INV-04
 *      rationale — raw log stays honest; rankings don't see it).
 *   2. Pre-aggregate rows in-memory by (day, client, server, project),
 *      dropping self-reference entries. Upsert into `server_stats_daily`.
 *   3. Recompute `unique_tools` per affected (day, ...) tuple by querying
 *      `mcp_calls` — summing per-day uniques across upserts would over-count
 *      tools that appear in the same batch twice.
 *
 * No side effects beyond the passed-in `db`. Safe to call from any thread
 * (better-sqlite3 serializes with `busy_timeout`).
 */
export function ingestCalls(
  db: Database,
  queries: Queries,
  calls: ReadonlyArray<McpCall>,
): IngestStats {
  if (calls.length === 0) {
    return { inserted: 0, selfReferenceExcluded: 0, dailyAggregatesAffected: 0 };
  }

  const { perDay, selfExcluded } = preaggregate(calls);

  const tx = db.transaction(() => {
    for (const call of calls) queries.insertCall(call);
    for (const agg of perDay.values()) queries.upsertServerStatDaily(agg);
    for (const agg of perDay.values()) {
      const [dayStartMs, dayEndMs] = dayBoundsMs(agg.day);
      queries.recomputeUniqueTools({
        day: agg.day,
        client: agg.client,
        server_name: agg.server_name,
        project_identity: agg.project_identity,
        day_start_ms: dayStartMs,
        day_end_ms: dayEndMs,
      });
    }
  });
  tx();

  return {
    inserted: calls.length,
    selfReferenceExcluded: selfExcluded,
    dailyAggregatesAffected: perDay.size,
  };
}

interface Preaggregated {
  perDay: Map<string, ServerStatDaily>;
  selfExcluded: number;
}

function preaggregate(calls: ReadonlyArray<McpCall>): Preaggregated {
  const perDay = new Map<string, ServerStatDaily>();
  let selfExcluded = 0;

  for (const call of calls) {
    if (SELF_REFERENCE_SERVERS.has(call.server_name)) {
      selfExcluded++;
      continue;
    }
    const day = isoDay(call.ts);
    const key = `${day}\u0000${call.client}\u0000${call.server_name}\u0000${call.project_identity}`;
    const existing = perDay.get(key);
    if (existing) {
      existing.calls += 1;
      existing.errors += call.is_error === true ? 1 : 0;
      existing.input_tokens += call.input_tokens;
      existing.output_tokens += call.output_tokens;
      existing.cache_read_tokens += call.cache_read_tokens;
      if (call.cost_is_estimated === 0) existing.cost_usd_real += call.cost_usd;
      else existing.cost_usd_est += call.cost_usd;
    } else {
      perDay.set(key, {
        day,
        client: call.client,
        server_name: call.server_name,
        project_identity: call.project_identity,
        calls: 1,
        errors: call.is_error === true ? 1 : 0,
        unique_tools: 0, // recomputed post-upsert from mcp_calls
        input_tokens: call.input_tokens,
        output_tokens: call.output_tokens,
        cache_read_tokens: call.cache_read_tokens,
        cost_usd_real: call.cost_is_estimated === 0 ? call.cost_usd : 0,
        cost_usd_est: call.cost_is_estimated === 1 ? call.cost_usd : 0,
      });
    }
  }

  return { perDay, selfExcluded };
}

/** Unix-ms timestamp → 'YYYY-MM-DD' in UTC. */
export function isoDay(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** UTC day bounds in unix ms: [dayStart, dayEnd). */
function dayBoundsMs(day: string): [number, number] {
  const year = Number.parseInt(day.slice(0, 4), 10);
  const month = Number.parseInt(day.slice(5, 7), 10) - 1;
  const dayOfMonth = Number.parseInt(day.slice(8, 10), 10);
  const start = Date.UTC(year, month, dayOfMonth);
  return [start, start + 24 * 60 * 60 * 1000];
}
