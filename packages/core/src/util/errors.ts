/**
 * Error hierarchy for messages that should reach the user verbatim.
 *
 * `UserFacingError` is what the server's `errorMiddleware` translates into a
 * `{error: {code, message, hint?}}` JSON envelope. Anything else throws is a
 * 5xx and gets logged with a stack trace; the response body never carries
 * implementation detail.
 *
 * Subclasses pin a default `status` and `code`. New subclasses must use a
 * snake_case `code` so frontend callers can switch on it without parsing
 * messages.
 */

export interface UserFacingErrorOptions {
  status?: number | undefined;
  hint?: string | undefined;
}

export class UserFacingError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly hint: string | undefined;

  constructor(code: string, message: string, options: UserFacingErrorOptions = {}) {
    super(message);
    this.name = 'UserFacingError';
    this.code = code;
    this.status = options.status ?? 400;
    this.hint = options.hint;
  }
}

export class BadRequestError extends UserFacingError {
  constructor(message: string, hint?: string) {
    super('bad_request', message, { status: 400, hint });
    this.name = 'BadRequestError';
  }
}

export class NotFoundError extends UserFacingError {
  constructor(message: string, hint?: string) {
    super('not_found', message, { status: 404, hint });
    this.name = 'NotFoundError';
  }
}

export class NotImplementedError extends UserFacingError {
  constructor(message: string, hint?: string) {
    super('not_implemented', message, { status: 501, hint });
    this.name = 'NotImplementedError';
  }
}
