import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { lazy, Suspense } from 'react';
import { Header } from '../components/header';
import { Sidebar } from '../components/sidebar';
import type { RouterContext } from '../router';

const TanStackRouterDevtools = import.meta.env.PROD
    ? () => null
    : lazy(() =>
          import('@tanstack/react-router-devtools').then((mod) => ({
              default: mod.TanStackRouterDevtools,
          })),
      );

const ReactQueryDevtools = import.meta.env.PROD
    ? () => null
    : lazy(() =>
          import('@tanstack/react-query-devtools').then((mod) => ({
              default: mod.ReactQueryDevtools,
          })),
      );

const ROOT_LAYOUT_NAME = 'RootLayout';

const RootLayout = (): ReactElement => {
    return (
        <div data-component={ROOT_LAYOUT_NAME} className="flex h-screen bg-background text-foreground">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
                <Header />
                <main className="flex-1 overflow-auto">
                    <Outlet />
                </main>
            </div>
            <Suspense>
                <TanStackRouterDevtools position="bottom-right" />
            </Suspense>
            <Suspense>
                <ReactQueryDevtools buttonPosition="bottom-left" />
            </Suspense>
        </div>
    );
};

RootLayout.displayName = ROOT_LAYOUT_NAME;

export const Route = createRootRouteWithContext<RouterContext>()({
    component: RootLayout,
});
