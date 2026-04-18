import { execSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getProjectIdentity, normalizeRemoteUrl } from '../../src/project/identity.js';

async function makeGitRepo(remote?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mcpi-gid-'));
  execSync('git init -q', { cwd: dir });
  execSync('git commit --allow-empty -q -m init', {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  if (remote) {
    execSync(`git remote add origin ${remote}`, { cwd: dir });
  }
  return dir;
}

describe('normalizeRemoteUrl', () => {
  it('strips trailing .git', () => {
    expect(normalizeRemoteUrl('https://github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('equates SSH shorthand and HTTPS for the same repo', () => {
    const ssh = normalizeRemoteUrl('git@github.com:org/repo.git');
    const https = normalizeRemoteUrl('https://github.com/org/repo.git');
    expect(ssh).toBe(https);
    expect(ssh).toBe('github.com/org/repo');
  });

  it('strips ssh:// scheme with user', () => {
    expect(normalizeRemoteUrl('ssh://git@github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('lowercases the canonical result', () => {
    expect(normalizeRemoteUrl('https://GitHub.COM/Org/Repo.git')).toBe('github.com/org/repo');
  });

  it('strips http creds if present', () => {
    expect(normalizeRemoteUrl('https://user:token@github.com/org/repo.git')).toBe(
      'github.com/org/repo',
    );
  });
});

describe('getProjectIdentity', () => {
  it('derives from git remote when origin is set', async () => {
    const repo = await makeGitRepo('https://github.com/org/repo.git');
    try {
      const result = getProjectIdentity(repo);
      expect(result.source).toBe('git');
      expect(result.canonicalInput).toBe('github.com/org/repo');
      expect(result.identity).toMatch(/^git:[0-9a-f]{12}$/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('falls back to cwd when no origin remote is configured', async () => {
    const repo = await makeGitRepo(); // no remote added
    try {
      const result = getProjectIdentity(repo);
      expect(result.source).toBe('cwd');
      expect(result.identity).toMatch(/^cwd:[0-9a-f]{12}$/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('falls back to cwd outside any git repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcpi-gid-plain-'));
    try {
      await writeFile(join(dir, 'noop.txt'), '');
      const result = getProjectIdentity(dir);
      expect(result.source).toBe('cwd');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('produces the same identity for SSH and HTTPS clones of the same repo', async () => {
    const ssh = await makeGitRepo('git@github.com:org/repo.git');
    const https = await makeGitRepo('https://github.com/org/repo.git');
    try {
      const a = getProjectIdentity(ssh);
      const b = getProjectIdentity(https);
      expect(a.identity).toBe(b.identity);
    } finally {
      await rm(ssh, { recursive: true, force: true });
      await rm(https, { recursive: true, force: true });
    }
  });

  it('returns a different identity when the remote URL differs', async () => {
    const a = await makeGitRepo('https://github.com/org/repo-a.git');
    const b = await makeGitRepo('https://github.com/org/repo-b.git');
    try {
      const x = getProjectIdentity(a);
      const y = getProjectIdentity(b);
      expect(x.identity).not.toBe(y.identity);
    } finally {
      await rm(a, { recursive: true, force: true });
      await rm(b, { recursive: true, force: true });
    }
  });
});
