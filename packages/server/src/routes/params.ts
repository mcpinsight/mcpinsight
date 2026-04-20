import { BadRequestError } from '@mcpinsight/core';
import type { Client } from '@mcpinsight/core';

/**
 * Query-param parsers shared by route handlers. Throw `BadRequestError` so
 * the central error middleware can translate to the `{error: {...}}` envelope
 * — handlers don't catch.
 *
 * Kept locally inside `routes/` (not in `@mcpinsight/core`) because the
 * BadRequest framing is specific to the HTTP boundary; the CLI uses different
 * error shapes for the same parsing.
 */

const VALID_CLIENTS: ReadonlySet<string> = new Set([
  'claude-code',
  'codex',
  'cursor',
  'windsurf',
  'copilot',
]);

export function parsePositiveInt(
  raw: string | undefined,
  name: string,
  defaultValue: number,
): number {
  if (raw === undefined || raw === '') return defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestError(`invalid ${name}: "${raw}"`, 'Expected positive integer.');
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestError(`invalid ${name}: "${raw}"`, 'Expected positive integer.');
  }
  return n;
}

export function parseClient(raw: string | undefined): Client | null {
  if (raw === undefined || raw === '') return null;
  if (!VALID_CLIENTS.has(raw)) {
    throw new BadRequestError(
      `invalid client: "${raw}"`,
      `Expected one of: ${[...VALID_CLIENTS].join(', ')}.`,
    );
  }
  return raw as Client;
}

export const VALID_CLIENT_IDS: ReadonlyArray<string> = [...VALID_CLIENTS];
