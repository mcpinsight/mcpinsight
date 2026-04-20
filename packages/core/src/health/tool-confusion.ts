/**
 * Tool-name confusion detection — one of five Health Score v2 factors.
 *
 * See ADR-0004 §"Tool-confusion calculation" for the algorithm and
 * false-positive trade-offs.
 *
 * Pure function: no I/O. Lives in `health/` (not `util/`) because it is
 * domain-specific to the Health Score; use outside that scope would be
 * speculative generalization.
 */

const PREFIX_LEN = 8;
const LEVENSHTEIN_THRESHOLD = 3;

/**
 * Fraction of tool names that are "confused" with at least one other tool
 * (Levenshtein distance < 3 on the first 8 characters, case-insensitive).
 *
 * @returns 0 when there is no confusion (perfect clarity), 1 when every tool
 *          is confused with at least one other, or a fraction in between.
 *          Returns 0 for empty or single-element inputs — there is no pair to
 *          confuse.
 *
 * Complexity O(n²·PREFIX_LEN). For n=100 this is ~80k character operations,
 * well under the 50 ms STOP budget in the Day 21 spec. Prefix bucketing is
 * future work if any single user observes n > 500.
 */
export function calculateToolConfusion(tools: ReadonlyArray<string>): number {
  if (tools.length < 2) return 0;

  const prefixes = tools.map((t) => t.slice(0, PREFIX_LEN).toLowerCase());
  const flagged = new Set<number>();

  for (let i = 0; i < prefixes.length; i++) {
    // Non-null assertion: loop bounds guarantee the index is in range, but
    // `noUncheckedIndexedAccess` widens the type to string | undefined.
    const a = prefixes[i] as string;
    for (let j = i + 1; j < prefixes.length; j++) {
      const b = prefixes[j] as string;
      if (levenshtein(a, b) < LEVENSHTEIN_THRESHOLD) {
        flagged.add(i);
        flagged.add(j);
      }
    }
  }

  return flagged.size / tools.length;
}

/**
 * Classic dynamic-programming Levenshtein distance. Two-row rolling buffer so
 * memory is O(min(|a|, |b|)). Input sizes here are bounded at PREFIX_LEN (8)
 * so the rolling optimization is cosmetic — kept for the pattern.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] as number) + 1;
      const ins = (curr[j - 1] as number) + 1;
      const sub = (prev[j - 1] as number) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] as number;
}
