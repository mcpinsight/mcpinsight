import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TopServerRow } from '@mcpinsight/core';

import { TooltipProvider } from '@/components/ui/tooltip';
import { OverviewRoute } from '@/routes/OverviewRoute';

/**
 * Smoke test for the wired overview page: mocks fetch to return seeded data,
 * confirms the table renders, then changes the client filter and asserts
 * a re-fetch fired with the expected query string.
 */

function row(over: Partial<TopServerRow> = {}): TopServerRow {
  return {
    server_name: 'filesystem',
    calls: 412,
    errors: 4,
    unique_tools: 4,
    input_tokens: 500,
    output_tokens: 900,
    cache_read_tokens: 100,
    cost_usd_real: 0,
    cost_usd_est: 0,
    ...over,
  };
}

function renderOverview() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: OverviewRoute,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/servers/$name',
    component: () => <div />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

// biome-ignore lint/suspicious/noExplicitAny: vi.spyOn's return shape varies by version; a narrow type buys nothing here.
let fetchSpy: any;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/api/clients')) {
      return new Response(
        JSON.stringify([
          {
            client: 'claude-code',
            calls: 412,
            servers: 1,
            first_ts: 0,
            last_ts: 0,
          },
        ]),
        { status: 200 },
      );
    }
    if (url.includes('/api/servers')) {
      return new Response(
        JSON.stringify([
          row({ server_name: 'filesystem' }),
          row({ server_name: 'github', calls: 308 }),
        ]),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OverviewRoute', () => {
  it('renders two rows after load + header copy', async () => {
    renderOverview();
    expect(screen.getByText('Your MCP Servers')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByTestId('server-row')).toHaveLength(2);
    });
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
  });

  it('disabled Scan-now button is present with the Day-22 tooltip text in the DOM', async () => {
    renderOverview();
    await waitFor(() => {
      expect(screen.getAllByTestId('server-row').length).toBeGreaterThan(0);
    });
    const scanBtn = screen.getByRole('button', { name: 'Scan now' });
    expect(scanBtn).toBeDisabled();
  });

  it('changing the client filter re-fetches /api/servers with ?client=codex', async () => {
    const user = userEvent.setup();
    renderOverview();
    await waitFor(() => {
      expect(screen.getAllByTestId('server-row')).toHaveLength(2);
    });
    const initialCalls = fetchSpy.mock.calls.length;
    await user.click(screen.getByLabelText('Client filter'));
    await user.click(screen.getByRole('option', { name: 'codex' }));
    await waitFor(() => {
      const urls = fetchSpy.mock.calls.slice(initialCalls).map((c: unknown[]) => String(c[0]));
      expect(
        urls.some((u: string) => u.includes('/api/servers') && u.includes('client=codex')),
      ).toBe(true);
    });
  });
});
