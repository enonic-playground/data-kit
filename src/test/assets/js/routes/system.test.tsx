// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { renderRoute, screen, waitFor, within } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
    apiFetch: vi.fn(),
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
    getConfig: vi.fn(() => ({
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
    })),
}));

import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';

const mockedApiFetch = vi.mocked(apiFetch);

function getSystemPage(): HTMLElement {
    const el = document.querySelector('[data-component="SystemPage"]');
    if (!el) throw new Error('SystemPage not found');
    return el as HTMLElement;
}

describe('SystemPage', () => {
    it('should render system info from API', async () => {
        mockedApiFetch.mockResolvedValue({
            xpVersion: '8.0.0',
            appVersion: '1.2.3',
            appName: 'com.enonic.app.datakit',
        });

        renderRoute({ initialLocation: '/system' });

        await waitFor(() => {
            expect(screen.getByText('8.0.0')).toBeInTheDocument();
        });

        expect(screen.getByText('1.2.3')).toBeInTheDocument();
        expect(screen.getByText('com.enonic.app.datakit')).toBeInTheDocument();
    });

    it('should display correct labels', async () => {
        mockedApiFetch.mockResolvedValue({
            xpVersion: '8.0.0',
            appVersion: '1.0.0',
            appName: 'test-app',
        });

        renderRoute({ initialLocation: '/system' });

        await waitFor(() => {
            getSystemPage();
        });

        const page = within(getSystemPage());
        expect(page.getByText('XP Version')).toBeInTheDocument();
        expect(page.getByText('App Version')).toBeInTheDocument();
        expect(page.getByText('App Name')).toBeInTheDocument();
    });
});
