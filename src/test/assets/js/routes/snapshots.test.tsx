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
      tasks: '/api/tasks',
    },
    launcherUri: '/launcher',
    user: { key: 'user:system:su', displayName: 'Super User' },
  })),
}));

import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';

const mockedApiFetch = vi.mocked(apiFetch);

function getSnapshotsPage(): HTMLElement {
  const el = document.querySelector('[data-component="SnapshotsPage"]');
  if (!el) throw new Error('SnapshotsPage not found');
  return el as HTMLElement;
}

function mockSnapshotsFetch(snapshots: unknown[], repositories: unknown[] = []) {
  mockedApiFetch.mockImplementation((url: string) => {
    if (url.includes('snapshots')) return Promise.resolve(snapshots);
    if (url.includes('repositories')) return Promise.resolve(repositories);
    return Promise.resolve([]);
  });
}

describe('SnapshotsPage', () => {
  it('should render snapshot table with data', async () => {
    mockSnapshotsFetch([
      {
        name: 'snap-2026-01-01',
        reason: 'test',
        timestamp: '2026-01-01T00:00:00Z',
        state: 'SUCCESS',
        indices: ['idx1', 'idx2'],
      },
      {
        name: 'snap-2026-01-02',
        reason: 'backup',
        timestamp: '2026-01-02T12:00:00Z',
        state: 'SUCCESS',
        indices: ['idx1'],
      },
    ]);

    renderRoute({ initialLocation: '/snapshots' });

    await waitFor(() => {
      getSnapshotsPage();
    });

    const page = within(getSnapshotsPage());
    expect(page.getByText('snap-2026-01-01')).toBeInTheDocument();
    expect(page.getByText('snap-2026-01-02')).toBeInTheDocument();
  });

  it('should show empty state when no snapshots exist', async () => {
    mockSnapshotsFetch([]);

    renderRoute({ initialLocation: '/snapshots' });

    await waitFor(() => {
      expect(screen.getByText('No snapshots')).toBeInTheDocument();
    });
  });

  it('should show create snapshot button', async () => {
    mockSnapshotsFetch([
      {
        name: 'snap-1',
        reason: 'test',
        timestamp: '2026-01-01T00:00:00Z',
        state: 'SUCCESS',
        indices: [],
      },
    ]);

    renderRoute({ initialLocation: '/snapshots' });

    await waitFor(() => {
      getSnapshotsPage();
    });

    const page = within(getSnapshotsPage());
    expect(page.getByRole('button', { name: /create snapshot/i })).toBeInTheDocument();
  });

  it('should display state badge', async () => {
    mockSnapshotsFetch([
      {
        name: 'snap-1',
        reason: 'test',
        timestamp: '2026-01-01T00:00:00Z',
        state: 'SUCCESS',
        indices: ['idx'],
      },
    ]);

    renderRoute({ initialLocation: '/snapshots' });

    await waitFor(() => {
      getSnapshotsPage();
    });

    const page = within(getSnapshotsPage());
    expect(page.getByText('SUCCESS')).toBeInTheDocument();
  });

  it('should display indices count', async () => {
    mockSnapshotsFetch([
      {
        name: 'snap-1',
        reason: 'test',
        timestamp: '2026-01-01T00:00:00Z',
        state: 'SUCCESS',
        indices: ['idx1', 'idx2', 'idx3'],
      },
    ]);

    renderRoute({ initialLocation: '/snapshots' });

    await waitFor(() => {
      getSnapshotsPage();
    });

    const page = within(getSnapshotsPage());
    expect(page.getByText('3')).toBeInTheDocument();
  });
});
