import { describe, expect, it } from 'vitest';

import { calculateToolConfusion } from '../../src/health/tool-confusion.js';

describe('calculateToolConfusion', () => {
  it('returns 0 for empty array', () => {
    expect(calculateToolConfusion([])).toBe(0);
  });

  it('returns 0 for a single tool (no pair to confuse)', () => {
    expect(calculateToolConfusion(['read_file'])).toBe(0);
  });

  it('returns 0 when all tool names are well-separated', () => {
    const tools = ['read_file', 'write_file', 'list_directory', 'search_files', 'delete_path'];
    expect(calculateToolConfusion(tools)).toBe(0);
  });

  it('flags all three variants of read-file (ratio 3/4 with one unrelated tool)', () => {
    const tools = ['read_file', 'read-file', 'readFile', 'write_file'];
    expect(calculateToolConfusion(tools)).toBeCloseTo(0.75);
  });

  it('treats full confusion (every tool flagged) as ratio 1', () => {
    const tools = ['read_file', 'read-file', 'readFile'];
    expect(calculateToolConfusion(tools)).toBe(1);
  });

  it('compares only the first 8 characters', () => {
    const tools = ['common_prefix_alpha', 'common_prefix_beta'];
    expect(calculateToolConfusion(tools)).toBe(1);
  });

  it('is case-insensitive on the prefix comparison', () => {
    const tools = ['ReadFile', 'readfile'];
    expect(calculateToolConfusion(tools)).toBe(1);
  });

  it('handles a 100-tool server under the 50ms budget', () => {
    const tools = Array.from(
      { length: 100 },
      (_, i) => `distinct_tool_${i.toString().padStart(3, '0')}`,
    );
    const start = performance.now();
    const confusion = calculateToolConfusion(tools);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(confusion).toBe(1);
  });
});
