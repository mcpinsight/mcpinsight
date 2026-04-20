import { describe, expect, it } from 'vitest';

import { systemClock } from '../../src/util/clock.js';

describe('systemClock', () => {
  it('returns a non-decreasing unix-ms timestamp', () => {
    const t0 = systemClock.now();
    const t1 = systemClock.now();
    expect(typeof t0).toBe('number');
    expect(t1).toBeGreaterThanOrEqual(t0);
  });

  it('is plausibly close to Date.now()', () => {
    const fromClock = systemClock.now();
    const fromDate = Date.now();
    expect(Math.abs(fromDate - fromClock)).toBeLessThan(100);
  });
});
