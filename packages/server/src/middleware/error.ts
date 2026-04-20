import { UserFacingError } from '@mcpinsight/core';
import type { Logger } from '@mcpinsight/core';
import type { ErrorHandler } from 'hono';

/**
 * Centralized error handler wired via `app.onError`. Two-branch contract:
 *
 *   - `UserFacingError` (and subclasses) → that error's `status` + the
 *     `{error: {code, message, hint?}}` envelope. Hint is omitted from the
 *     JSON when not provided (JSON.stringify drops `undefined`).
 *
 *   - Anything else → 500 + opaque envelope. The full message + stack go
 *     to the logger so devs can debug, but never to the response body.
 *
 * Returning a raw `Response` sidesteps Hono v4's narrowed `c.json(_, status)`
 * status-code typing for the small set of dynamic statuses we emit.
 */
export function createErrorHandler(logger: Logger): ErrorHandler {
  return (err, c) => {
    if (err instanceof UserFacingError) {
      return jsonResponse(err.status, {
        error: {
          code: err.code,
          message: err.message,
          ...(err.hint !== undefined ? { hint: err.hint } : {}),
        },
      });
    }
    logger.error('unhandled_error', {
      message: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
    });
    return jsonResponse(500, {
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
      },
    });
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
