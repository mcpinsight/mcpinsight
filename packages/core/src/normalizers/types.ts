/**
 * Normalizer shared utilities. Client-specific normalizers live in
 * sibling files (claude-code.ts, codex.ts, cursor.ts) and import from here.
 *
 * Pure functions only. INV-05: normalizers never touch the DB.
 */

/**
 * Claude Code / Codex tool-use names follow `mcp__<server>__<tool>`.
 * Returns `null` for names that don't match the MCP prefix (so callers can
 * skip non-MCP tool_use events like `Bash`, `Read`, `Edit`).
 *
 * Examples:
 *   parseMcpToolName('mcp__filesystem__read_file')
 *     → { server: 'filesystem', tool: 'read_file' }
 *   parseMcpToolName('mcp__claude_ai_Google_Drive__authenticate')
 *     → { server: 'claude_ai_Google_Drive', tool: 'authenticate' }
 *   parseMcpToolName('Bash') → null
 */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const prefix = 'mcp__';
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const sep = rest.indexOf('__');
  if (sep <= 0) return null; // no server name before separator
  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);
  if (server.length === 0 || tool.length === 0) return null;
  return { server, tool };
}
