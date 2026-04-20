import type { Clock, Logger, Queries } from '@mcpinsight/core';

/**
 * Dependencies injected into `createApp` and `startServer`. Routes pull from
 * here rather than reaching for module-scope singletons — keeps the server
 * testable without a live DB or real clock.
 */
export interface Deps {
  queries: Queries;
  clock: Clock;
  logger: Logger;
}
