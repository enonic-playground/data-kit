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

function getSystemPage(): HTMLElement {
  const el = document.querySelector('[data-component="SystemPage"]');
  if (!el) throw new Error('SystemPage not found');
  return el as HTMLElement;
}

function buildSystemInfo(overrides?: Partial<Record<string, unknown>>) {
  return {
    xpVersion: '8.0.0',
    appName: 'com.enonic.app.datakit',
    appVersion: '1.2.3',
    javaVersion: '17.0.9',
    javaVendor: 'Eclipse Adoptium',
    osName: 'Linux',
    osArch: 'amd64',
    osVersion: '6.1.0',
    xpHome: '/opt/xp/home',
    diskTotal: 0,
    diskUsable: 0,
    ...overrides,
  };
}

describe('SystemPage', () => {
  it('should render system info from API', async () => {
    mockedApiFetch.mockResolvedValue(buildSystemInfo());

    renderRoute({ initialLocation: '/system' });

    await waitFor(() => {
      expect(screen.getByText('8.0.0')).toBeInTheDocument();
    });

    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('com.enonic.app.datakit')).toBeInTheDocument();
    expect(screen.getByText('17.0.9')).toBeInTheDocument();
    expect(screen.getByText('Eclipse Adoptium')).toBeInTheDocument();
    expect(screen.getByText('Linux')).toBeInTheDocument();
    expect(screen.getByText('amd64')).toBeInTheDocument();
    expect(screen.getByText('/opt/xp/home')).toBeInTheDocument();
  });

  it('should display card titles', async () => {
    mockedApiFetch.mockResolvedValue(buildSystemInfo());

    renderRoute({ initialLocation: '/system' });

    await waitFor(() => {
      getSystemPage();
    });

    const page = within(getSystemPage());
    expect(page.getByText('XP Runtime')).toBeInTheDocument();
    expect(page.getByText('Application')).toBeInTheDocument();
    expect(page.getByText('Java Runtime')).toBeInTheDocument();
    expect(page.getByText('Operating System')).toBeInTheDocument();
    expect(page.getByText('Appearance')).toBeInTheDocument();
  });

  it('should render disk usage when diskTotal > 0', async () => {
    mockedApiFetch.mockResolvedValue(
      buildSystemInfo({
        diskTotal: 100 * 1024 ** 3,
        diskUsable: 40 * 1024 ** 3,
      }),
    );

    renderRoute({ initialLocation: '/system' });

    await waitFor(() => {
      getSystemPage();
    });

    const page = within(getSystemPage());
    expect(page.getByText('60%')).toBeInTheDocument();
    expect(page.getByText(/used of/)).toBeInTheDocument();
  });

  it('should hide disk usage when diskTotal is 0', async () => {
    mockedApiFetch.mockResolvedValue(buildSystemInfo());

    renderRoute({ initialLocation: '/system' });

    await waitFor(() => {
      getSystemPage();
    });

    const page = within(getSystemPage());
    expect(page.queryByText(/used of/)).not.toBeInTheDocument();
  });

  it('should link to Enonic documentation', async () => {
    mockedApiFetch.mockResolvedValue(buildSystemInfo());

    renderRoute({ initialLocation: '/system' });

    await waitFor(() => {
      getSystemPage();
    });

    const link = within(getSystemPage()).getByRole('link', {
      name: /Enonic documentation/i,
    });
    expect(link).toHaveAttribute('href', 'https://developer.enonic.com');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
