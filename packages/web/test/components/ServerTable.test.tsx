import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import type { TopServerRow } from '@mcpinsight/core';

import { ServerTable } from '@/components/shared/ServerTable';
import { TooltipProvider } from '@/components/ui/tooltip';

function row(over: Partial<TopServerRow> = {}): TopServerRow {
  return {
    server_name: 'filesystem',
    calls: 100,
    errors: 0,
    unique_tools: 2,
    input_tokens: 400,
    output_tokens: 600,
    cache_read_tokens: 1000,
    cost_usd_real: 0,
    cost_usd_est: 0,
    ...over,
  };
}

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{ui}</>,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/servers/$name',
    component: () => <div data-testid="detail-route" />,
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

describe('ServerTable', () => {
  it('renders a row per server with formatted numbers', () => {
    renderWithProviders(
      <ServerTable
        rows={[
          row({ server_name: 'filesystem', calls: 1204, errors: 0, unique_tools: 4 }),
          row({ server_name: 'github', calls: 308, errors: 18, unique_tools: 2 }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId('server-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('1,204')).toBeInTheDocument();
    expect(screen.getByText('100.0%')).toBeInTheDocument();
  });

  it('shows "—" in the Health column for every row (Day 20 placeholder)', () => {
    renderWithProviders(<ServerTable rows={[row({ server_name: 'filesystem' })]} />);
    const badges = screen.getAllByLabelText('Health Score ships Day 21.');
    expect(badges[0]).toHaveTextContent('—');
  });

  it('colors a low success rate as destructive', () => {
    renderWithProviders(
      <ServerTable rows={[row({ server_name: 'flaky', calls: 100, errors: 30 })]} />,
    );
    const cell = screen.getByText('70.0%');
    expect(cell.className).toContain('text-destructive');
  });

  it('links each server name to /servers/:name', () => {
    renderWithProviders(<ServerTable rows={[row({ server_name: 'slack mcp' })]} />);
    const link = screen.getByRole('link', { name: 'slack mcp' });
    expect(link.getAttribute('href')).toBe('/servers/slack%20mcp');
  });
});
