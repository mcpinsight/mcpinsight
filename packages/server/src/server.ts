import { type ServerType, serve } from '@hono/node-server';

import { createApp } from './app.js';
import type { Deps } from './types.js';

export interface StartServerOptions {
  /** Port to bind. `0` (default) asks the OS for a free port. */
  port?: number;
  /** Host to bind. Defaults to `127.0.0.1` (INV-07 — keep on loopback). */
  host?: string;
  /**
   * Optional absolute path to `packages/web/dist/`. When supplied, the SPA
   * is served alongside the API from the same origin — see
   * `middleware/static-spa.ts`.
   */
  webDistDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
}

/**
 * Build the app, bind it on the requested port/host, and resolve once the
 * socket is actually listening. The returned `url` reflects the assigned
 * port (relevant when caller passed `0`).
 *
 * Errors during bind reject the promise; runtime request errors are routed
 * through Hono's `onError` middleware (see `middleware/error.ts`).
 */
export function startServer(deps: Deps, options: StartServerOptions = {}): Promise<RunningServer> {
  const app = createApp(deps, {
    ...(options.webDistDir !== undefined ? { webDistDir: options.webDistDir } : {}),
  });
  const port = options.port ?? 0;
  const host = options.host ?? '127.0.0.1';

  return new Promise<RunningServer>((resolve, reject) => {
    let resolved = false;
    const onError = (err: Error): void => {
      if (!resolved) reject(err);
    };

    // `serve()` returns the http.Server synchronously and registers a listen()
    // callback that fires asynchronously after this assignment completes —
    // so the closure inside `close: () => server.close(...)` is safe.
    const server: ServerType = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
      resolved = true;
      const assignedPort = info.port;
      const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
      resolve({
        url: `http://${displayHost}:${assignedPort}`,
        port: assignedPort,
        host: displayHost,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => {
              if (err) closeReject(err);
              else closeResolve();
            });
          }),
      });
    });

    server.on('error', onError);
  });
}
