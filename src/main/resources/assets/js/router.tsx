import type { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import type { DataKitConfig } from './lib/config';
import { routeTree } from './routeTree.gen';

export type RouterContext = {
    queryClient: QueryClient;
    config: DataKitConfig;
};

type CreateAppRouterOptions = {
    queryClient: QueryClient;
    config: DataKitConfig;
};

export function createAppRouter({ queryClient, config }: CreateAppRouterOptions) {
    return createRouter({
        routeTree,
        context: { queryClient, config },
        basepath: config.toolUri,
        defaultPreloadStaleTime: 0,
    });
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof createAppRouter>;
    }
}
