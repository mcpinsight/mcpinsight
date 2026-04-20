import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeHealthScore } from '../../src/health/score.js';
import type { ServerHealthInputs } from '../../src/health/score.js';
import {
  ACTIVATION_SATURATION,
  ESSENTIAL_FLOOR,
  ESSENTIAL_THRESHOLD,
  MIN_DAYS_HISTORY,
  MIN_TOTAL_CALLS,
  TOKEN_EFF_CAP,
  TOOLUTIL_SATURATION,
  WEIGHTS,
} from '../../src/health/score.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', 'fixtures', 'health');

interface Fixture {
  scenario: string;
  description: string;
  expected_score?: number | null;
  expected_score_gt?: number;
  expected_clarity_lt?: number;
  expected_insufficient_reason?: 'too_recent' | 'too_few_calls';
  inputs: ServerHealthInputs;
  now_ms: number;
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf-8')) as Fixture;
}

const NOW = Date.UTC(2026, 3, 26);

function baseInputs(overrides: Partial<ServerHealthInputs> = {}): ServerHealthInputs {
  return {
    server_name: 'alpha',
    total_calls_all_servers: 120,
    earliest_ts_ms: NOW - 30 * 86_400_000,
    calls_30d: 30,
    errors_30d: 0,
    scored_calls_30d: 30,
    output_tokens_30d: 30_000,
    tools_30d: ['t_one', 't_two', 't_three', 't_four', 't_five'],
    server_project_count: 1,
    user_project_count: 3,
    ...overrides,
  };
}

describe('weights', () => {
  it('sum to 1.0', () => {
    const total =
      WEIGHTS.activation +
      WEIGHTS.successRate +
      WEIGHTS.toolUtil +
      WEIGHTS.clarity +
      WEIGHTS.tokenEff;
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('individual weights match ADR-0004', () => {
    expect(WEIGHTS.activation).toBeCloseTo(0.3);
    expect(WEIGHTS.successRate).toBeCloseTo(0.3);
    expect(WEIGHTS.toolUtil).toBeCloseTo(0.2);
    expect(WEIGHTS.clarity).toBeCloseTo(0.1);
    expect(WEIGHTS.tokenEff).toBeCloseTo(0.1);
  });
});

describe('computeHealthScore — insufficient data path', () => {
  it('returns too_recent when earliest_ts is null (no calls at all)', () => {
    const result = computeHealthScore(baseInputs({ earliest_ts_ms: null }), NOW);
    expect(result.score).toBeNull();
    expect(result.components).toBeNull();
    expect(result.insufficient_data_reason).toBe('too_recent');
  });

  it('returns too_recent when history < 14 days', () => {
    const result = computeHealthScore(
      baseInputs({ earliest_ts_ms: NOW - (MIN_DAYS_HISTORY - 1) * 86_400_000 }),
      NOW,
    );
    expect(result.score).toBeNull();
    expect(result.insufficient_data_reason).toBe('too_recent');
  });

  it('returns too_few_calls when history is enough but total calls < 50', () => {
    const result = computeHealthScore(
      baseInputs({
        earliest_ts_ms: NOW - 30 * 86_400_000,
        total_calls_all_servers: MIN_TOTAL_CALLS - 1,
      }),
      NOW,
    );
    expect(result.score).toBeNull();
    expect(result.insufficient_data_reason).toBe('too_few_calls');
  });

  it('when BOTH conditions fail, too_recent wins (T3 tie-breaker)', () => {
    const result = computeHealthScore(
      baseInputs({
        earliest_ts_ms: NOW - 2 * 86_400_000, // 2 days
        total_calls_all_servers: 3,
      }),
      NOW,
    );
    expect(result.insufficient_data_reason).toBe('too_recent');
  });

  it('insufficient-data pre-empts zero-calls (T4 tie-breaker)', () => {
    const result = computeHealthScore(
      baseInputs({
        earliest_ts_ms: NOW - 3 * 86_400_000, // 3 days — too recent
        calls_30d: 0,
      }),
      NOW,
    );
    expect(result.score).toBeNull();
    expect(result.insufficient_data_reason).toBe('too_recent');
  });

  it('is_essential is still populated on the insufficient-data path', () => {
    const result = computeHealthScore(
      baseInputs({
        earliest_ts_ms: NOW - 2 * 86_400_000,
        server_project_count: 3,
        user_project_count: 3,
      }),
      NOW,
    );
    expect(result.score).toBeNull();
    expect(result.is_essential).toBe(true);
  });
});

describe('computeHealthScore — zero-calls path', () => {
  it('returns score 0 for 0 calls in 30d (zombie)', () => {
    const result = computeHealthScore(
      baseInputs({ calls_30d: 0, tools_30d: [], scored_calls_30d: 0 }),
      NOW,
    );
    expect(result.score).toBe(0);
    expect(result.components).not.toBeNull();
  });

  it('zero-calls wins over essential-server floor (T1 tie-breaker)', () => {
    const result = computeHealthScore(
      baseInputs({
        calls_30d: 0,
        tools_30d: [],
        scored_calls_30d: 0,
        server_project_count: 3,
        user_project_count: 3,
      }),
      NOW,
    );
    expect(result.is_essential).toBe(true);
    expect(result.score).toBe(0);
  });
});

describe('computeHealthScore — essential-server override', () => {
  it('floors essential servers at 50 when raw score < 50', () => {
    const result = computeHealthScore(
      baseInputs({
        calls_30d: 3, // low activation
        scored_calls_30d: 3,
        errors_30d: 3, // 100% error rate
        tools_30d: ['x'], // low tool util
        output_tokens_30d: 30_000, // high avg output
        server_project_count: 3,
        user_project_count: 3,
      }),
      NOW,
    );
    expect(result.is_essential).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(ESSENTIAL_FLOOR);
  });

  it('does not floor non-essential servers', () => {
    const result = computeHealthScore(
      baseInputs({
        calls_30d: 3,
        scored_calls_30d: 3,
        errors_30d: 3,
        tools_30d: ['x'],
        output_tokens_30d: 30_000,
        server_project_count: 1,
        user_project_count: 5, // 1/5 = 0.2 — not essential
      }),
      NOW,
    );
    expect(result.is_essential).toBe(false);
    expect(result.score).toBeLessThan(ESSENTIAL_FLOOR);
  });

  it('essential threshold check is strict (> not >=)', () => {
    const result = computeHealthScore(
      baseInputs({
        server_project_count: 4,
        user_project_count: 5, // 0.8 exactly — NOT essential
      }),
      NOW,
    );
    expect(ESSENTIAL_THRESHOLD).toBe(0.8);
    expect(result.is_essential).toBe(false);
  });

  it('single-project user has every server essential', () => {
    const result = computeHealthScore(
      baseInputs({ server_project_count: 1, user_project_count: 1 }),
      NOW,
    );
    expect(result.is_essential).toBe(true);
  });

  it('user_project_count = 0 does not crash (is_essential = false)', () => {
    const result = computeHealthScore(
      baseInputs({
        server_project_count: 0,
        user_project_count: 0,
        calls_30d: 0,
        tools_30d: [],
        scored_calls_30d: 0,
      }),
      NOW,
    );
    expect(result.is_essential).toBe(false);
    expect(result.score).toBe(0);
  });
});

describe('computeHealthScore — component math', () => {
  it('activation saturates at 30 calls (1 call/day average)', () => {
    const result = computeHealthScore(baseInputs({ calls_30d: ACTIVATION_SATURATION }), NOW);
    expect(result.components?.activation).toBe(1);
  });

  it('activation is 0.5 at 15 calls (half-saturation)', () => {
    const result = computeHealthScore(baseInputs({ calls_30d: ACTIVATION_SATURATION / 2 }), NOW);
    expect(result.components?.activation).toBeCloseTo(0.5);
  });

  it('successRate excludes is_error=null from denominator', () => {
    // 40 scored calls out of 50 total, 2 errors → rate = 38/40 = 0.95
    const result = computeHealthScore(
      baseInputs({ calls_30d: 50, scored_calls_30d: 40, errors_30d: 2 }),
      NOW,
    );
    expect(result.components?.successRate).toBeCloseTo(0.95);
  });

  it('successRate is 1 when every is_error is null (scored_calls_30d = 0)', () => {
    const result = computeHealthScore(
      baseInputs({ calls_30d: 50, scored_calls_30d: 0, errors_30d: 0 }),
      NOW,
    );
    expect(result.components?.successRate).toBe(1);
  });

  it('toolUtil saturates at TOOLUTIL_SATURATION distinct tools', () => {
    const tools = Array.from({ length: TOOLUTIL_SATURATION }, (_, i) => `t_${i}`);
    const result = computeHealthScore(baseInputs({ tools_30d: tools }), NOW);
    expect(result.components?.toolUtil).toBe(1);
  });

  it('toolUtil is 0.4 at 2 distinct tools', () => {
    const result = computeHealthScore(baseInputs({ tools_30d: ['a', 'b'] }), NOW);
    expect(result.components?.toolUtil).toBeCloseTo(0.4);
  });

  it('tokenEff is 0 when avg output tokens >= 10000', () => {
    const result = computeHealthScore(
      baseInputs({ calls_30d: 1, output_tokens_30d: TOKEN_EFF_CAP }),
      NOW,
    );
    expect(result.components?.tokenEff).toBe(0);
  });

  it('tokenEff is 0.5 at 5000 avg output tokens', () => {
    const result = computeHealthScore(baseInputs({ calls_30d: 1, output_tokens_30d: 5_000 }), NOW);
    expect(result.components?.tokenEff).toBeCloseTo(0.5);
  });

  it('clarity equals 1 when tools are distinct (no confusion)', () => {
    const result = computeHealthScore(
      baseInputs({ tools_30d: ['alpha', 'bravo', 'charlie'] }),
      NOW,
    );
    expect(result.components?.clarity).toBe(1);
  });

  it('clarity drops when tool names confuse', () => {
    const result = computeHealthScore(
      baseInputs({ tools_30d: ['read_file', 'read-file', 'readFile'] }),
      NOW,
    );
    expect(result.components?.clarity).toBe(0);
  });

  it('produces a score in [0, 100]', () => {
    const result = computeHealthScore(baseInputs(), NOW);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('computeHealthScore — fixture regression', () => {
  it('active-essential fixture scores > 60', () => {
    const fix = loadFixture('active-essential');
    const result = computeHealthScore(fix.inputs, fix.now_ms);
    expect(result.score).not.toBeNull();
    expect(result.score ?? 0).toBeGreaterThan(fix.expected_score_gt ?? 0);
    expect(result.is_essential).toBe(true);
  });

  it('zombie fixture scores exactly 0', () => {
    const fix = loadFixture('zombie');
    const result = computeHealthScore(fix.inputs, fix.now_ms);
    expect(result.score).toBe(fix.expected_score);
  });

  it('confused-tools fixture has clarity < 0.5', () => {
    const fix = loadFixture('confused-tools');
    const result = computeHealthScore(fix.inputs, fix.now_ms);
    expect(result.components?.clarity).toBeLessThan(fix.expected_clarity_lt ?? 1);
  });

  it('insufficient-data fixture returns null + too_few_calls', () => {
    const fix = loadFixture('insufficient-data');
    const result = computeHealthScore(fix.inputs, fix.now_ms);
    expect(result.score).toBe(fix.expected_score);
    expect(result.insufficient_data_reason).toBe(fix.expected_insufficient_reason);
  });
});
