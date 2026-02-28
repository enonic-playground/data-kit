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

function getRepoPage(): HTMLElement {
    const el = document.querySelector('[data-component="RepositoriesPage"]');
    if (!el) throw new Error('RepositoriesPage not found');
    return el as HTMLElement;
}

describe('RepositoriesPage', () => {
    it('should render repository table with data', async () => {
        mockedApiFetch.mockResolvedValue([
            { id: 'com.enonic.cms.default', branches: ['master', 'draft'] },
            { id: 'system-repo', branches: ['master'] },
        ]);

        renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            getRepoPage();
        });

        const page = within(getRepoPage());
        expect(page.getByText('com.enonic.cms.default')).toBeInTheDocument();
        expect(page.getByText('system-repo')).toBeInTheDocument();
    });

    it('should show empty state when no repositories exist', async () => {
        mockedApiFetch.mockResolvedValue([]);

        renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            expect(screen.getByText('No repositories')).toBeInTheDocument();
        });
    });

    it('should show branch count badges', async () => {
        mockedApiFetch.mockResolvedValue([
            { id: 'my-repo', branches: ['master', 'draft', 'test'] },
        ]);

        renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            getRepoPage();
        });

        const page = within(getRepoPage());
        expect(page.getByText('my-repo')).toBeInTheDocument();
        expect(page.getByText('3')).toBeInTheDocument();
    });

    it('should show create repository button', async () => {
        mockedApiFetch.mockResolvedValue([
            { id: 'test-repo', branches: ['master'] },
        ]);

        renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            getRepoPage();
        });

        const page = within(getRepoPage());
        expect(
            page.getByRole('button', { name: /create repository/i }),
        ).toBeInTheDocument();
    });

    it('should validate repository name on create dialog', async () => {
        mockedApiFetch.mockResolvedValue([
            { id: 'test-repo', branches: ['master'] },
        ]);

        const { user } = renderRoute({ initialLocation: '/repositories' });

        await waitFor(() => {
            getRepoPage();
        });

        const page = within(getRepoPage());
        await user.click(
            page.getByRole('button', { name: /create repository/i }),
        );

        await waitFor(() => {
            expect(
                screen.getByRole('button', { name: 'Create' }),
            ).toBeInTheDocument();
        });

        // Type a too-short name and submit
        const input = screen.getByLabelText('Repository Name');
        await user.type(input, 'ab');
        await user.click(screen.getByRole('button', { name: 'Create' }));

        await waitFor(() => {
            expect(
                screen.getByText('Must be at least 3 characters'),
            ).toBeInTheDocument();
        });
    });
});
