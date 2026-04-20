/**
 * Injectable clock. Business logic that timestamps data should accept a
 * `Clock` parameter rather than reading `Date.now()` directly — tests then
 * provide a fake clock for deterministic assertions.
 *
 * `systemClock` is the production default.
 */

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
