import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './components/theme-provider';
import { getConfig } from './lib/config';
import { createAppRouter } from './router';

const config = getConfig();
const queryClient = new QueryClient();
const router = createAppRouter({ queryClient, config });

const APP_NAME = 'App';

const App = (): ReactElement => {
    return (
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
            </QueryClientProvider>
        </ThemeProvider>
    );
};

App.displayName = APP_NAME;

const container = document.getElementById('app');

if (container) {
    createRoot(container).render(<App />);
}

console.debug('Data Kit ready', { appId: config.appId });
