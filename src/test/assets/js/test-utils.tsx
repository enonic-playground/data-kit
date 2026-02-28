import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../../../main/resources/assets/js/components/theme-provider';
import { TooltipProvider } from '../../../main/resources/assets/js/components/ui/tooltip';
import type { DataKitConfig } from '../../../main/resources/assets/js/lib/config';
import { routeTree } from '../../../main/resources/assets/js/routeTree.gen';

export function buildConfig(overrides?: Partial<DataKitConfig>): DataKitConfig {
    return {
        appId: 'com.enonic.app.datakit',
        assetsUri: '/assets',
        toolUri: '/',
        apiUris: {
            system: '/api/system',
            repositories: '/api/repositories',
            branches: '/api/branches',
            nodes: '/api/nodes',
            search: '/api/search',
        },
        launcherUri: '/launcher',
        user: { key: 'user:system:su', displayName: 'Super User' },
        ...overrides,
    };
}

type RenderRouteOptions = {
    initialLocation?: string;
};

type RenderRouteResult = {
    user: ReturnType<typeof userEvent.setup>;
};

export function renderRoute({ initialLocation = '/' }: RenderRouteOptions = {}): RenderRouteResult {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });

    const config = buildConfig();

    const router = createRouter({
        routeTree,
        context: { queryClient, config },
        basepath: config.toolUri,
        defaultPreloadStaleTime: 0,
        history: createMemoryHistory({ initialEntries: [initialLocation] }),
    });

    const Wrapper = (): ReactElement => (
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>
                <TooltipProvider>
                    <RouterProvider router={router} />
                </TooltipProvider>
            </QueryClientProvider>
        </ThemeProvider>
    );

    const user = userEvent.setup();
    render(<Wrapper />);

    return { user };
}

export { screen, waitFor, within };
