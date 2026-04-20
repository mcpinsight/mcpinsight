/**
 * Structured logger. One JSON object per line on a writable stream (default
 * `process.stderr` — never stdout, which the CLI reserves for user-facing
 * output like tables and JSON contract responses).
 *
 * Library code MUST go through this logger; raw `console.log` is a biome
 * warning and an anti-pattern in `backend-node.md`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface CreateLoggerOptions {
  level?: LogLevel;
  stream?: NodeJS.WritableStream;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const minPriority = LEVEL_PRIORITY[options.level ?? 'info'];
  const stream = options.stream ?? process.stderr;

  function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < minPriority) return;
    const line: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg,
    };
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        line[k] = v;
      }
    }
    stream.write(`${JSON.stringify(line)}\n`);
  }

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}

/** No-op logger. Useful in tests where log noise just clutters output. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
