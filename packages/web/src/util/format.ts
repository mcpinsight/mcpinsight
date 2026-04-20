/**
 * Format helpers — centralized so `toLocaleString` doesn't get scattered.
 * All formatting is en-US in Y1 per INV-08.
 */

export function formatInt(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatSuccessRate(calls: number, errors: number): string {
  if (calls <= 0) return '—';
  const pct = ((calls - errors) / calls) * 100;
  return `${pct.toFixed(1)}%`;
}

/** Client-side derivation — API does not ship a success-rate field. */
export function computeSuccessRate(calls: number, errors: number): number | null {
  if (calls <= 0) return null;
  return (calls - errors) / calls;
}

/** Sum of the three token columns returned by `TopServerRow`. */
export function totalTokens(row: {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
}): number {
  return row.input_tokens + row.output_tokens + row.cache_read_tokens;
}

/**
 * Tiny mustache-style interpolation. Skips any key missing from `vars` so a
 * typo renders as the literal placeholder rather than `undefined`.
 *
 * `t('Hello {{name}}', { name: 'World' })` → `'Hello World'`.
 */
export function t(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? `{{${key}}}` : String(value);
  });
}
