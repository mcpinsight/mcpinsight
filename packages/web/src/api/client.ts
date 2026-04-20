import type { ClientListRow, TopServerRow } from '@mcpinsight/core';
import type { Client, ServerHealth } from '@mcpinsight/core/types';

/**
 * Shape of the `{error: {code, message, hint?}}` envelope from
 * `packages/server/src/middleware/error.ts`. Typed here so callers can narrow
 * on 501 (placeholder surface) vs other 4xx/5xx without a `string` cast.
 */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    hint?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string | undefined;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.error.message);
    this.status = status;
    this.code = envelope.error.code;
    this.hint = envelope.error.hint;
    this.name = 'ApiError';
  }

  /**
   * 501 is a documented-placeholder contract (Day 19 `/api/health/:name`,
   * `POST /api/scan`). Callers treat this as "not an error — render a
   * placeholder card" rather than triggering a toast.
   */
  get isPlaceholder(): boolean {
    return this.status === 501 || this.code === 'not_implemented';
  }
}

/**
 * Base URL for API calls. In dev (`vite` on :5173) we hit the Hono server
 * running on a user-supplied port via `VITE_API_BASE`. In bundled mode
 * (`mcpinsight serve` serving `packages/web/dist`), the web is same-origin
 * with the API — leaving the base empty falls back to relative URLs.
 */
const BASE = import.meta.env.VITE_API_BASE ?? '';

type QueryValue = string | number | null | undefined;

function qs(params: Readonly<Record<string, QueryValue>> | undefined): string {
  if (!params) return '';
  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    entries.push([k, String(v)]);
  }
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

async function req<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const envelope = await safeEnvelope(res);
    throw new ApiError(res.status, envelope);
  }
  return (await res.json()) as T;
}

async function safeEnvelope(res: Response): Promise<ApiErrorEnvelope> {
  try {
    const body = (await res.json()) as unknown;
    if (
      body !== null &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'object'
    ) {
      return body as ApiErrorEnvelope;
    }
  } catch {
    // fall through to synthetic envelope
  }
  return {
    error: {
      code: `http_${res.status}`,
      message: `Request failed with status ${res.status}`,
    },
  };
}

export interface TimeseriesPoint {
  day: string;
  calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ServerDetailResponse {
  server_name: string;
  summary: TopServerRow;
  timeseries: ReadonlyArray<TimeseriesPoint>;
  /** Day 21 additive: distinct tool names observed in window, alphabetized. */
  tools: ReadonlyArray<string>;
}

export const api = {
  health(): Promise<{ ok: boolean; version: string }> {
    return req('/api/health');
  },

  servers(params?: { client?: Client | 'all'; days?: number; limit?: number }): Promise<
    TopServerRow[]
  > {
    return req<TopServerRow[]>(
      `/api/servers${qs({
        days: params?.days,
        limit: params?.limit,
        client: params?.client === 'all' ? undefined : params?.client,
      })}`,
    );
  },

  server(name: string, params?: { days?: number }): Promise<ServerDetailResponse> {
    return req<ServerDetailResponse>(
      `/api/servers/${encodeURIComponent(name)}${qs({ days: params?.days })}`,
    );
  },

  clients(params?: { days?: number; limit?: number }): Promise<ClientListRow[]> {
    return req<ClientListRow[]>(`/api/clients${qs(params)}`);
  },

  /**
   * Health Score v2 — per-server. 30-day window fixed server-side (ADR-0004);
   * the `client` param is the only caller-tunable knob.
   */
  healthScore(name: string, params?: { client?: Client | 'all' }): Promise<ServerHealth> {
    return req<ServerHealth>(
      `/api/health/${encodeURIComponent(name)}${qs({
        client: params?.client === 'all' ? undefined : params?.client,
      })}`,
    );
  },
};
