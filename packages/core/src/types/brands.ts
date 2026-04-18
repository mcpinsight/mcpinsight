import type { ProjectIdentity, SessionId } from './canonical.js';

/**
 * Untyped-string → branded-type constructors. Use at the normalizer boundary
 * where upstream data is known to be a session/project id by context but the
 * compiler has only seen a plain string.
 *
 * The brand is erased at runtime; these are type-level assertions only.
 */
export const asSessionId = (value: string): SessionId => value as SessionId;
export const asProjectIdentity = (value: string): ProjectIdentity => value as ProjectIdentity;
