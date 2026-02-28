// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { renderRoute, screen, waitFor } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
    apiFetch: vi.fn().mockResolvedValue([]),
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

describe('Header', () => {
    it('should show "Repositories" title on repositories route', async () => {
        renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            expect(
                screen.getByRole('heading', { level: 1, name: 'Repositories' }),
            ).toBeInTheDocument();
        });
    });

    it('should show "System" title on system route', async () => {
        mockedApiFetch.mockResolvedValue({
            xpVersion: '8.0.0',
            appVersion: '1.0.0',
            appName: 'test',
        });

        renderRoute({ initialLocation: '/system' });

        await waitFor(() => {
            expect(
                screen.getByRole('heading', { level: 1, name: 'System' }),
            ).toBeInTheDocument();
        });
    });

    it('should show "Snapshots" title on snapshots route', async () => {
        renderRoute({ initialLocation: '/snapshots' });

        await waitFor(() => {
            expect(
                screen.getByRole('heading', {
                    level: 1,
                    name: 'Snapshots',
                }),
            ).toBeInTheDocument();
        });
    });
});
