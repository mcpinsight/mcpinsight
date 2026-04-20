/**
 * Canonical shapes — the one source of truth for cross-package types.
 * Every parser/normalizer produces McpCall; every query returns one of these rows.
 *
 * NEVER define these types in another file. Import from here.
 * NEVER mutate a field shape without an ADR and a schema migration.
 *
 * Referenced by: CLAUDE.md §6 (INV-05, INV-02), skills/mcp-protocol.md.
 */

// Brand helper for IDs that shouldn't be swapped accidentally.
type Brand<T, B> = T & { readonly __brand: B };

export type SessionId = Brand<string, 'SessionId'>;
export type ProjectIdentity = Brand<string, 'ProjectIdentity'>;

export type Client = 'claude-code' | 'codex' | 'cursor' | 'windsurf' | 'copilot';

/**
 * Every valid `Client` id, in canonical order. Consumers that need a list of
 * options (a CLI flag validator, a dashboard dropdown) MUST import this
 * rather than inlining the tuple — changing the set of supported clients is a
 * single-file edit.
 *
 * `as const` locks the array's element type to the `Client` literal union —
 * the redundant `satisfies` sanity-checks that every member is in fact a
 * `Client`, so a typo at add-time fails the compile rather than the runtime.
 */
export const CLIENT_IDS = [
  'claude-code',
  'codex',
  'cursor',
  'windsurf',
  'copilot',
] as const satisfies ReadonlyArray<Client>;

/**
 * The canonical event: one MCP tool call, normalized across all clients.
 *
 * `is_error: null` means "unknowable" (compacted session, no matching tool_result).
 * `cost_is_estimated` is INV-02: 0 = real cost from API key holder, 1 = estimated.
 */
export interface McpCall {
  client: Client;
  session_id: SessionId;
  project_identity: ProjectIdentity; // INV-01: git-remote-derived preferred
  server_name: string; // e.g., "filesystem"
  tool_name: string; // e.g., "read" or "browse__search"
  ts: number; // unix ms
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  cost_is_estimated: 0 | 1; // INV-02
  is_error: boolean | null; // null when unknowable
  duration_ms: number | null;
}

/**
 * Aggregate row for the daily rollup table. Written by the aggregator, read by queries.
 */
export interface ServerStatDaily {
  day: string; // ISO date "YYYY-MM-DD"
  client: Client;
  server_name: string;
  project_identity: ProjectIdentity;
  calls: number;
  errors: number;
  unique_tools: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd_real: number; // only from cost_is_estimated = 0 rows
  cost_usd_est: number; // only from cost_is_estimated = 1 rows
}

/**
 * Health score per server, as shown in the dashboard.
 * `score = null` when insufficient data (<14 days history or <50 total calls).
 */
export interface ServerHealth {
  server_name: string;
  score: number | null; // 0-100 or null
  components: {
    activation: number; // 0-1
    successRate: number; // 0-1
    toolUtil: number; // 0-1
    clarity: number; // 0-1 (1 - confusion)
    tokenEff: number; // 0-1
  } | null; // null when score is null
  is_essential: boolean; // true = floor score at 50
  insufficient_data_reason?: 'too_recent' | 'too_few_calls';
}

/**
 * Parser interface: raw bytes → raw client-specific event.
 * Pure function; no I/O beyond what the caller provides.
 */
export interface ClientParser<RawEvent = unknown> {
  readonly client: Client;
  readonly version: number;
  /**
   * @param line A single JSONL line (trimmed or not).
   * @returns parsed event or null for irrelevant lines.
   *          Throws only on programmer error; malformed JSON returns null + emits a diagnostic.
   */
  parseLine(line: string): RawEvent | null;
  /** Paths on disk for this OS. Caller decides whether to read them. */
  defaultLogPaths(): string[];
}

/**
 * Normalizer interface: raw client event → canonical McpCall.
 * Pure function. Handles edge cases per client-specific quirks.
 */
export interface ClientNormalizer<RawEvent = unknown> {
  readonly client: Client;
  readonly version: number;
  normalize(raw: RawEvent, ctx: NormalizeContext): McpCall | null;
}

export interface NormalizeContext {
  projectIdentity: ProjectIdentity;
  /** True if the user has a raw API key configured; drives cost_is_estimated. */
  hasApiKey: boolean;
}

/**
 * Result<T, E>: preferred over throw for expected failures (malformed JSONL, missing files).
 * See skills/backend-node.md.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
