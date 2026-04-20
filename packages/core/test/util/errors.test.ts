import { describe, expect, it } from 'vitest';

import {
  BadRequestError,
  NotFoundError,
  NotImplementedError,
  UserFacingError,
} from '../../src/util/errors.js';

describe('UserFacingError', () => {
  it('defaults status to 400 and stores code, message, hint', () => {
    const err = new UserFacingError('foo', 'bar', { hint: 'baz' });
    expect(err.code).toBe('foo');
    expect(err.message).toBe('bar');
    expect(err.status).toBe(400);
    expect(err.hint).toBe('baz');
    expect(err.name).toBe('UserFacingError');
  });

  it('accepts a custom status', () => {
    const err = new UserFacingError('teapot', 'short and stout', { status: 418 });
    expect(err.status).toBe(418);
    expect(err.hint).toBeUndefined();
  });

  it('omits hint cleanly when not supplied', () => {
    const err = new UserFacingError('foo', 'bar');
    expect(err.hint).toBeUndefined();
  });
});

describe('BadRequestError', () => {
  it('pins code=bad_request and status=400', () => {
    const err = new BadRequestError('invalid days', 'expected positive integer');
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err.code).toBe('bad_request');
    expect(err.status).toBe(400);
    expect(err.hint).toBe('expected positive integer');
    expect(err.name).toBe('BadRequestError');
  });
});

describe('NotFoundError', () => {
  it('pins code=not_found and status=404', () => {
    const err = new NotFoundError('no such server');
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err.code).toBe('not_found');
    expect(err.status).toBe(404);
    expect(err.hint).toBeUndefined();
    expect(err.name).toBe('NotFoundError');
  });
});

describe('NotImplementedError', () => {
  it('pins code=not_implemented and status=501', () => {
    const err = new NotImplementedError('ships day 21');
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err.code).toBe('not_implemented');
    expect(err.status).toBe(501);
    expect(err.name).toBe('NotImplementedError');
  });
});
