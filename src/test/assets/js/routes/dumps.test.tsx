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
            binary: '/api/binary',
            snapshots: '/api/snapshots',
            dumps: '/api/dumps',
            exports: '/api/exports',
            tasks: '/api/tasks',
            events: '/api/events',
        },
        launcherUri: '/launcher',
        user: { key: 'user:system:su', displayName: 'Super User' },
    })),
}));

import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';

const mockedApiFetch = vi.mocked(apiFetch);

function getDumpsPage(): HTMLElement {
    const el = document.querySelector('[data-component="DumpsPage"]');
    if (!el) throw new Error('DumpsPage not found');
    return el as HTMLElement;
}

function mockDumpsFetch(dumps: unknown[]) {
    mockedApiFetch.mockImplementation((url: string) => {
        if (url.includes('dumps')) return Promise.resolve(dumps);
        return Promise.resolve([]);
    });
}

describe('DumpsPage', () => {
    it('should render dump table with data', async () => {
        mockDumpsFetch([
            { name: 'dump-2026-01-01', timestamp: '2026-01-01T00:00:00Z', type: 'versioned', xpVersion: '8.0.0', modelVersion: '12', size: 1048576 },
            { name: 'dump-2026-01-02', timestamp: '2026-01-02T12:00:00Z', type: 'archived', xpVersion: '7.14.0', modelVersion: '11', size: 2097152 },
        ]);

        renderRoute({ initialLocation: '/dumps' });

        await waitFor(() => {
            getDumpsPage();
        });

        const page = within(getDumpsPage());
        expect(page.getByText('dump-2026-01-01')).toBeInTheDocument();
        expect(page.getByText('dump-2026-01-02')).toBeInTheDocument();
    });

    it('should show empty state when no dumps exist', async () => {
        mockDumpsFetch([]);

        renderRoute({ initialLocation: '/dumps' });

        await waitFor(() => {
            expect(screen.getByText('No dumps')).toBeInTheDocument();
        });
    });

    it('should show create dump button', async () => {
        mockDumpsFetch([
            { name: 'dump-1', timestamp: '2026-01-01T00:00:00Z', type: 'versioned', xpVersion: '8.0.0', modelVersion: '12', size: 1024 },
        ]);

        renderRoute({ initialLocation: '/dumps' });

        await waitFor(() => {
            getDumpsPage();
        });

        const page = within(getDumpsPage());
        expect(
            page.getByRole('button', { name: /create dump/i }),
        ).toBeInTheDocument();
    });

    it('should display formatted size', async () => {
        mockDumpsFetch([
            { name: 'dump-1', timestamp: '2026-01-01T00:00:00Z', type: 'versioned', xpVersion: '8.0.0', modelVersion: '12', size: 1048576 },
        ]);

        renderRoute({ initialLocation: '/dumps' });

        await waitFor(() => {
            getDumpsPage();
        });

        const page = within(getDumpsPage());
        expect(page.getByText('1.0 MB')).toBeInTheDocument();
    });

    it('should display XP version', async () => {
        mockDumpsFetch([
            { name: 'dump-1', timestamp: '2026-01-01T00:00:00Z', type: 'versioned', xpVersion: '8.0.0', modelVersion: '12', size: 1024 },
        ]);

        renderRoute({ initialLocation: '/dumps' });

        await waitFor(() => {
            getDumpsPage();
        });

        const page = within(getDumpsPage());
        expect(page.getByText('8.0.0')).toBeInTheDocument();
    });
});
