import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

/**
 * Expand a leading `~` into the current user's home directory.
 * Non-tilde paths pass through unchanged.
 */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith(`~${sep}`) || p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Recursively collect `.jsonl` session files under a Claude Code projects root.
 *
 * Expected layout:
 *   <root>/<project-hash>/<session-id>.jsonl
 *   <root>/<project-hash>/<session-id>/subagents/agent-<id>.jsonl
 *
 * Missing roots resolve to `[]` (the user might not use this client).
 * Non-jsonl files and directories are walked but only `.jsonl` leaves are returned.
 */
export async function discoverSessionFiles(root: string): Promise<string[]> {
  const expanded = expandHome(root);
  const out: string[] = [];
  await walk(expanded, out);
  out.sort();
  return out;
}

async function walk(dir: string, acc: string[]): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, acc);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        acc.push(full);
      }
    }
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    throw cause;
  }
}
