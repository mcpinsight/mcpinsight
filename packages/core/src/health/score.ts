import type { ServerHealth } from '../types/canonical.js';
import { calculateToolConfusion } from './tool-confusion.js';

/**
 * Aggregate inputs to the Health Score algorithm — produced by
 * `queries.healthInputs` (DB layer) and consumed by `computeHealthScore`
 * (pure). Keeping the type here (not in `types/canonical.ts`) because it is
 * internal to `health/`; consumers talk in `ServerHealth` which is canonical.
 */
export interface ServerHealthInputs {
  server_name: string;
  /** Total calls across the full history (all-time). Used for user-level min-data check. */
  total_calls_all_servers: number;
  /** Earliest call ts across the user's full history (unix ms), or null if no calls. */
  earliest_ts_ms: number | null;
  /** Calls in the last 30 days for THIS server. */
  calls_30d: number;
  /** Errors (is_error=1) in the last 30 days for THIS server. */
  errors_30d: number;
  /** Calls where is_error is NOT NULL in the last 30 days for THIS server. */
  scored_calls_30d: number;
  /** Sum of output_tokens in the last 30 days for THIS server. */
  output_tokens_30d: number;
  /** Distinct tool names observed in the last 30 days for THIS server (alphabetized). */
  tools_30d: ReadonlyArray<string>;
  /** Distinct projects that ever touched this server (all-time). */
  server_project_count: number;
  /** Distinct projects across the user's full history (all-time). */
  user_project_count: number;
}

/** Minimum-data thresholds — mirrored in ADR-0004. */
export const MIN_DAYS_HISTORY = 14;
export const MIN_TOTAL_CALLS = 50;
/** Essential-server floor — mirrored in ADR-0004. */
export const ESSENTIAL_FLOOR = 50;
/** Essential-server threshold: used in >80% of user's projects. */
export const ESSENTIAL_THRESHOLD = 0.8;
/** Activation saturates at ~1 call/day over 30 days. */
export const ACTIVATION_SATURATION = 30;
/** Tool-util saturates at 5 distinct tools observed. */
export const TOOLUTIL_SATURATION = 5;
/** Token-efficiency saturates (score 0) at 10k avg output tokens. */
export const TOKEN_EFF_CAP = 10_000;

/** Weights — sum to 1.0. Unit-tested. */
export const WEIGHTS = {
  activation: 0.3,
  successRate: 0.3,
  toolUtil: 0.2,
  clarity: 0.1,
  tokenEff: 0.1,
} as const;

const DAY_MS = 86_400_000;

/**
 * Compute the Health Score v2 per ADR-0004.
 *
 * Cascade (matches ADR §Tie-breakers):
 *   1. Insufficient user-level data → {score: null, reason}
 *   2. Zero calls in window → score 0 (zombie)
 *   3. Raw weighted sum → 0..100, then essential-server floor if applicable
 */
export function computeHealthScore(inputs: ServerHealthInputs, nowMs: number): ServerHealth {
  const is_essential = computeIsEssential(inputs);

  const insufficient = checkInsufficientData(inputs, nowMs);
  if (insufficient !== null) {
    // `exactOptionalPropertyTypes: true` — only include the optional field
    // when it has a concrete value.
    return {
      server_name: inputs.server_name,
      score: null,
      components: null,
      is_essential,
      insufficient_data_reason: insufficient,
    };
  }

  if (inputs.calls_30d === 0) {
    return {
      server_name: inputs.server_name,
      score: 0,
      components: {
        activation: 0,
        successRate: 1,
        toolUtil: 0,
        clarity: 1,
        tokenEff: 1,
      },
      is_essential,
    };
  }

  const components = {
    activation: clamp01(inputs.calls_30d / ACTIVATION_SATURATION),
    successRate: computeSuccessRate(inputs),
    toolUtil: clamp01(inputs.tools_30d.length / TOOLUTIL_SATURATION),
    clarity: 1 - calculateToolConfusion(inputs.tools_30d),
    tokenEff: computeTokenEff(inputs),
  };

  const raw =
    components.activation * WEIGHTS.activation +
    components.successRate * WEIGHTS.successRate +
    components.toolUtil * WEIGHTS.toolUtil +
    components.clarity * WEIGHTS.clarity +
    components.tokenEff * WEIGHTS.tokenEff;

  let score = Math.round(raw * 100);
  if (is_essential && score < ESSENTIAL_FLOOR) score = ESSENTIAL_FLOOR;

  return {
    server_name: inputs.server_name,
    score,
    components,
    is_essential,
  };
}

function computeIsEssential(inputs: ServerHealthInputs): boolean {
  if (inputs.user_project_count <= 0) return false;
  return inputs.server_project_count / inputs.user_project_count > ESSENTIAL_THRESHOLD;
}

type InsufficientReason = 'too_recent' | 'too_few_calls';

function checkInsufficientData(
  inputs: ServerHealthInputs,
  nowMs: number,
): InsufficientReason | null {
  if (inputs.earliest_ts_ms === null) return 'too_recent';
  const days = (nowMs - inputs.earliest_ts_ms) / DAY_MS;
  if (days < MIN_DAYS_HISTORY) return 'too_recent';
  if (inputs.total_calls_all_servers < MIN_TOTAL_CALLS) return 'too_few_calls';
  return null;
}

function computeSuccessRate(inputs: ServerHealthInputs): number {
  if (inputs.scored_calls_30d === 0) return 1;
  return (inputs.scored_calls_30d - inputs.errors_30d) / inputs.scored_calls_30d;
}

function computeTokenEff(inputs: ServerHealthInputs): number {
  if (inputs.calls_30d === 0) return 1;
  const avg = inputs.output_tokens_30d / inputs.calls_30d;
  return 1 - clamp01(avg / TOKEN_EFF_CAP);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
