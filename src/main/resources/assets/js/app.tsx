import { createRoot } from 'react-dom/client';

const scriptEl = document.currentScript as HTMLScriptElement | null;
const adminUrl = scriptEl?.dataset.adminUrl ?? '';
const toolUrl = scriptEl?.dataset.toolUrl ?? '';

function App() {
    return <h1>Data Kit</h1>;
}

const container = document.getElementById('app');
if (container) {
    createRoot(container).render(<App />);
}

console.debug('Data Kit ready', { adminUrl, toolUrl });
