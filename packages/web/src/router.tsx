import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { OverviewRoute } from '@/routes/OverviewRoute';
import { ServerDetailRoute } from '@/routes/ServerDetailRoute';

/**
 * Code-based TanStack Router tree. Two routes cover v0.1: the overview (index)
 * and the per-server detail. Adding a settings route later follows the same
 * pattern — new `createRoute` + `addChildren` entry.
 */

const rootRoute = createRootRoute({
  component: RootLayout,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewRoute,
});

const serverDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/servers/$name',
  component: ServerDetailRoute,
});

const routeTree = rootRoute.addChildren([overviewRoute, serverDetailRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function RootLayout() {
  return <Outlet />;
}
