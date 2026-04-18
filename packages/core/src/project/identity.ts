import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { asProjectIdentity } from '../types/brands.js';
import type { ProjectIdentity } from '../types/canonical.js';

export interface ProjectIdentityResult {
  identity: ProjectIdentity;
  /** 'git' when derived from git-remote; 'cwd' when falling back to path hash. */
  source: 'git' | 'cwd';
  /** The canonical input that was hashed (normalized remote URL or path). */
  canonicalInput: string;
}

/**
 * INV-01: Project identity is derived from `git remote get-url origin`,
 * falling back to a sha256 of the (normalized) working directory when no
 * origin remote is configured or git is unavailable.
 *
 * Format: `git:<12-char-hex>` or `cwd:<12-char-hex>`. Short, copy-pasteable,
 * collision-safe at expected scale (<1k projects per user lifetime).
 *
 * Edge cases:
 * - **Submodule**: returns the submodule's own origin (which differs from the
 *   parent repo's). That's the honest answer — a submodule IS a separate
 *   project from the parent.
 * - **Worktree**: returns the main repo's origin (worktrees share `config`).
 * - **Detached HEAD**: no impact; remote URL is independent of HEAD.
 * - **SSH vs HTTPS**: `git@github.com:org/repo.git` and
 *   `https://github.com/org/repo.git` normalize to the same canonical string
 *   so cloning via either scheme produces the same identity.
 */
export function getProjectIdentity(cwd: string): ProjectIdentityResult {
  const absoluteCwd = resolve(cwd);
  const remote = tryGitRemoteOrigin(absoluteCwd);
  if (remote !== null) {
    const canonical = normalizeRemoteUrl(remote);
    return build('git', canonical);
  }
  return build('cwd', normalizePath(absoluteCwd));
}

function build(source: 'git' | 'cwd', canonicalInput: string): ProjectIdentityResult {
  const digest = createHash('sha256').update(canonicalInput).digest('hex').slice(0, 12);
  return {
    identity: asProjectIdentity(`${source}:${digest}`),
    source,
    canonicalInput,
  };
}

/** Return the raw output of `git remote get-url origin`, or null on any failure. */
export function tryGitRemoteOrigin(cwd: string): string | null {
  try {
    const res = spawnSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    if (res.status !== 0) return null;
    const out = res.stdout.trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Canonicalize a git remote URL so equivalent URLs hash to the same identity.
 *
 * Normalizations:
 *   - strip trailing `.git`
 *   - strip ssh user (`git@`, `ubuntu@`, ...)
 *   - collapse scheme-prefixed and SSH-shorthand forms to `host/path`
 *   - lowercase (GitHub/GitLab are case-insensitive for host and org/repo)
 */
export function normalizeRemoteUrl(url: string): string {
  let u = url.trim().replace(/\.git$/i, '');
  const sshShort = u.match(/^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+):([^/].*)$/);
  if (sshShort) {
    u = `${sshShort[1]}/${sshShort[2]}`;
  } else {
    u = u.replace(/^[a-z]+:\/\//i, '').replace(/^[^@/]+@/, '');
  }
  return u.toLowerCase();
}

function normalizePath(p: string): string {
  return p.replace(/\/+/g, '/').replace(/\/+$/, '');
}
