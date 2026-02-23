import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './components/theme-provider';
import { getConfig } from './lib/config';

const APP_NAME = 'App';

const App = (): ReactElement => {
    return (
        <ThemeProvider>
            <h1>Data Kit</h1>
        </ThemeProvider>
    );
};

App.displayName = APP_NAME;

const config = getConfig();
const container = document.getElementById('app');

if (container) {
    createRoot(container).render(<App />);
}

console.debug('Data Kit ready', { appId: config.appId });
