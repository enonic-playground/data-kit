// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderRoute, waitFor, within } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => ({
    appId: 'com.enonic.app.datakit',
    assetsUri: '/assets',
    toolUri: '/',
    apiUris: {
      nodes: '/api/nodes',
      binary: '/api/binary',
      branches: '/api/branches',
      versions: '/api/versions',
    },
    launcherUri: '/launcher',
    user: { key: 'user:system:su', displayName: 'Super User' },
  })),
}));

import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';

const mockedApiFetch = vi.mocked(apiFetch);

const IMAGE_NODE = {
  _id: 'img-1',
  _name: 'logo.png',
  _path: '/logo.png',
  hasChildren: false,
  _nodeType: 'default',
  _ts: '2026-01-01T00:00:00Z',
  _versionKey: 'ver-abc',
  image: { binaryReference: 'logo.png', mimeType: 'image/png', size: 2048 },
};

const FOLDER_NODE = {
  _id: 'folder-1',
  _name: 'photos',
  _path: '/photos',
  hasChildren: true,
  _nodeType: 'default',
  _ts: '2026-01-02T00:00:00Z',
  _versionKey: 'ver-def',
};

const DOC_NODE = {
  _id: 'doc-1',
  _name: 'report.pdf',
  _path: '/report.pdf',
  hasChildren: false,
  _nodeType: 'default',
  _ts: '2026-01-03T00:00:00Z',
  _versionKey: 'ver-ghi',
};

const EMPTY_VERSIONS = {
  total: 0,
  count: 0,
  cursor: null,
  activeVersionId: null,
  hits: [],
};

type NodeList = { nodes: unknown[]; total: number };

function getBrowserPage(): HTMLElement {
  const el = document.querySelector('[data-component="NodeBrowserPage"]');
  if (!el) throw new Error('NodeBrowserPage not found');
  return el as HTMLElement;
}

function getGrid(): HTMLElement {
  const el = document.querySelector('[data-component="NodeGrid"]');
  if (!el) throw new Error('NodeGrid not found');
  return el as HTMLElement;
}

// The browser route fans out to several endpoints at once; each needs its own shape.
function routeApi(nodesByPath: Record<string, NodeList>) {
  mockedApiFetch.mockImplementation((uri: string, options?: unknown) => {
    const params = (options as { params?: Record<string, string> } | undefined)?.params ?? {};

    if (uri === '/api/branches') return Promise.resolve([{ id: 'master' }, { id: 'draft' }]);
    if (uri === '/api/versions') return Promise.resolve(EMPTY_VERSIONS);
    if (uri === '/api/nodes' && params.key != null) {
      return Promise.resolve({ ...IMAGE_NODE, _childOrder: '_name ASC', _permissions: [] });
    }

    return Promise.resolve(nodesByPath[params.parentPath ?? '/'] ?? { nodes: [], total: 0 });
  });
}

async function renderBrowser() {
  routeApi({
    '/': { nodes: [IMAGE_NODE, FOLDER_NODE, DOC_NODE], total: 3 },
    '/photos': { nodes: [], total: 0 },
  });

  const { user } = renderRoute({ initialLocation: '/repositories/my-repo/master' });

  await waitFor(() => {
    getBrowserPage();
  });

  return { user };
}

async function switchToGrid(user: Awaited<ReturnType<typeof renderBrowser>>['user']) {
  await user.click(within(getBrowserPage()).getByRole('button', { name: 'Grid view' }));
  await waitFor(() => {
    getGrid();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NodeBrowserPage grid view', () => {
  it('should render the table until grid view is selected', async () => {
    const { user } = await renderBrowser();

    expect(document.querySelector('[data-component="NodeGrid"]')).toBeNull();

    await switchToGrid(user);

    expect(document.querySelector('table')).toBeNull();
  });

  it('should render a thumbnail for an image node, keyed on its version', async () => {
    const { user } = await renderBrowser();
    await switchToGrid(user);

    const img = within(getGrid()).getByAltText('logo.png') as HTMLImageElement;
    const url = new URL(img.src);

    expect(url.pathname).toBe('/api/binary');
    expect(url.searchParams.get('key')).toBe('img-1');
    expect(url.searchParams.get('binaryReference')).toBe('logo.png');
    expect(url.searchParams.get('inline')).toBe('true');
    expect(url.searchParams.get('v')).toBe('ver-abc');
  });

  it('should fall back to an icon for nodes without an image attachment', async () => {
    const { user } = await renderBrowser();
    await switchToGrid(user);

    const grid = within(getGrid());
    expect(grid.queryByAltText('report.pdf')).toBeNull();
    expect(grid.queryByAltText('photos')).toBeNull();
    expect(grid.getByText('report.pdf')).toBeInTheDocument();
    expect(grid.getByText('photos')).toBeInTheDocument();
  });

  it('should open the detail panel on a single click', async () => {
    const { user } = await renderBrowser();
    await switchToGrid(user);

    await user.click(within(getGrid()).getByText('logo.png'));

    await waitFor(() => {
      expect(document.querySelector('[data-component="NodeDetailPanel"]')).not.toBeNull();
    });
  });

  it('should descend into a folder on a double click', async () => {
    const { user } = await renderBrowser();
    await switchToGrid(user);

    await user.dblClick(within(getGrid()).getByText('photos'));

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        '/api/nodes',
        expect.objectContaining({
          params: expect.objectContaining({ parentPath: '/photos' }),
        }),
      );
    });
  });
});
