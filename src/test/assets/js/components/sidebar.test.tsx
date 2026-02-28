// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { renderRoute, screen, waitFor, within } from '../test-utils';

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

const NAV_LABELS = [
    'Repositories',
    'Search',
    'Snapshots',
    'Dumps',
    'Exports',
    'Tasks',
    'Audit',
    'Events',
    'System',
];

function getSidebar(): HTMLElement {
    return screen.getByRole('complementary');
}

describe('Sidebar', () => {
    it('should render all navigation items', async () => {
        renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            getSidebar();
        });

        const sidebar = within(getSidebar());
        for (const label of NAV_LABELS) {
            expect(sidebar.getByText(label)).toBeInTheDocument();
        }
    });

    it('should collapse and expand', async () => {
        const { user } = renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            getSidebar();
        });

        const sidebar = within(getSidebar());

        // Collapse — nav labels should disappear
        await user.click(sidebar.getByRole('button', { name: 'Collapse sidebar' }));

        await waitFor(() => {
            expect(sidebar.queryByText('Repositories')).not.toBeInTheDocument();
        });

        // Expand — nav labels should reappear
        await user.click(sidebar.getByRole('button', { name: 'Expand sidebar' }));

        await waitFor(() => {
            expect(sidebar.getByText('Repositories')).toBeInTheDocument();
        });
    });

    it('should navigate when clicking a nav item', async () => {
        const { user } = renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            getSidebar();
        });

        const sidebar = within(getSidebar());
        await user.click(sidebar.getByText('Search'));

        await waitFor(() => {
            expect(
                screen.getByRole('heading', { level: 1, name: 'Search' }),
            ).toBeInTheDocument();
        });
    });
});
