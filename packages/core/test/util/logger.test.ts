import { describe, expect, it } from 'vitest';

import { createLogger, silentLogger } from '../../src/util/logger.js';

class CaptureStream {
  private buf = '';
  write(chunk: string | Uint8Array): boolean {
    this.buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }
  get text(): string {
    return this.buf;
  }
  get lines(): string[] {
    return this.buf.split('\n').filter((l) => l.length > 0);
  }
}

describe('createLogger', () => {
  it('emits one JSON object per line on the supplied stream', () => {
    const stream = new CaptureStream();
    const log = createLogger({ stream });
    log.info('hello', { user: 'alice' });

    expect(stream.lines).toHaveLength(1);
    const parsed = JSON.parse(stream.lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.user).toBe('alice');
    expect(typeof parsed.ts).toBe('string');
  });

  it('respects the level threshold (default info drops debug)', () => {
    const stream = new CaptureStream();
    const log = createLogger({ stream });
    log.debug('quiet');
    log.info('audible');
    expect(stream.lines).toHaveLength(1);
    expect((JSON.parse(stream.lines[0] ?? '{}') as Record<string, unknown>).msg).toBe('audible');
  });

  it('debug level emits debug + info + warn + error', () => {
    const stream = new CaptureStream();
    const log = createLogger({ stream, level: 'debug' });
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(stream.lines).toHaveLength(4);
  });

  it('error level drops info and warn', () => {
    const stream = new CaptureStream();
    const log = createLogger({ stream, level: 'error' });
    log.info('drop');
    log.warn('drop');
    log.error('keep');
    expect(stream.lines).toHaveLength(1);
    expect((JSON.parse(stream.lines[0] ?? '{}') as Record<string, unknown>).msg).toBe('keep');
  });

  it('handles missing meta param', () => {
    const stream = new CaptureStream();
    const log = createLogger({ stream });
    log.info('no meta');
    const parsed = JSON.parse(stream.lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.msg).toBe('no meta');
  });
});

describe('silentLogger', () => {
  it('is a no-op for every level', () => {
    silentLogger.debug('x');
    silentLogger.info('x');
    silentLogger.warn('x');
    silentLogger.error('x');
    // Reaching this line means no throw, which is the contract.
    expect(true).toBe(true);
  });
});
