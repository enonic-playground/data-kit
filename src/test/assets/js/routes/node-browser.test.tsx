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

const NESTED_NODE = {
  _id: 'nested-1',
  _name: 'beach.jpg',
  _path: '/photos/beach.jpg',
  hasChildren: false,
  _nodeType: 'default',
  _ts: '2026-01-04T00:00:00Z',
  _versionKey: 'ver-jkl',
};

const EMPTY_VERSIONS = {
  total: 0,
  count: 0,
  cursor: null,
  activeVersionId: null,
  hits: [],
};

const ONE_VERSION = {
  total: 1,
  count: 1,
  cursor: null,
  activeVersionId: 'v-active',
  hits: [
    {
      versionId: 'v-old',
      nodeId: 'img-1',
      nodePath: '/logo.png',
      timestamp: '2026-01-01T00:00:00Z',
    },
  ],
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

const RAIL_SELECTOR = '[data-component="NodeSiblingRail"]';

function getDetailView(): HTMLElement {
  const el = document.querySelector('[data-component="NodeDetailView"]');
  if (!el) throw new Error('NodeDetailView not found');
  return el as HTMLElement;
}

function getRail(): HTMLElement {
  const el = document.querySelector(RAIL_SELECTOR);
  if (!el) throw new Error('NodeSiblingRail not found');
  return el as HTMLElement;
}

function getCrumbs(): HTMLElement {
  const el = document.querySelector('[data-component="BreadcrumbToolbar"]');
  if (!el) throw new Error('BreadcrumbToolbar not found');
  return el as HTMLElement;
}

// The active crumb is the only one styled as current; everything left of it stays a link.
function getActiveCrumb(): HTMLElement {
  const el = getCrumbs().querySelector('.text-foreground');
  if (!el) throw new Error('active crumb not found');
  return el as HTMLElement;
}

function getBrowseList(): HTMLElement {
  const el = document.querySelector('[data-component="NodeBrowseList"]');
  if (!el) throw new Error('NodeBrowseList not found');
  return el as HTMLElement;
}

function getGridCell(name: string): HTMLElement {
  const el = within(getGrid()).getByText(name).closest('button');
  if (!el) throw new Error(`grid cell not found: ${name}`);
  return el;
}

function getRailRow(name: string): HTMLElement {
  const el = within(getRail()).getByText(name).closest('button');
  if (!el) throw new Error(`rail row not found: ${name}`);
  return el;
}

const FAILING_NODE_ID = 'broken-1';

const NODES_BY_ID: Record<string, object> = {
  'img-1': IMAGE_NODE,
  'folder-1': FOLDER_NODE,
  'doc-1': DOC_NODE,
  'nested-1': NESTED_NODE,
};

// Only an image node resolves a binary in production, which is what keeps a preview off the rest.
const IMAGES_BY_ID: Record<string, object> = {
  'img-1': { binaryReference: 'logo.png', mimeType: 'image/png', size: 2048 },
};

// `image` decorates a browse-list entry, never a node detail.
function detailFor(node: object): object {
  const { image: _image, ...rest } = node as Record<string, unknown>;
  return {
    ...rest,
    _childOrder: '_name ASC',
    _permissions: [],
    displayName: `${String(rest._name)} title`,
  };
}

// The browser route fans out to several endpoints at once; each needs its own shape.
// An unstubbed request throws — a stub that answers anything cannot catch a wrong request.
function routeApi(nodesByPath: Record<string, NodeList>, versions: object = EMPTY_VERSIONS) {
  mockedApiFetch.mockImplementation((uri: string, options?: unknown) => {
    const params = (options as { params?: Record<string, string> } | undefined)?.params ?? {};

    if (uri === '/api/branches') return Promise.resolve([{ id: 'master' }, { id: 'draft' }]);
    if (uri === '/api/versions') return Promise.resolve(versions);

    if (uri === '/api/binary') {
      const image = IMAGES_BY_ID[params.key ?? ''];
      if (image == null) return Promise.reject(new Error(`no binary for ${params.key}`));
      return Promise.resolve(image);
    }

    if (uri === '/api/nodes' && params.key != null) {
      if (params.key === FAILING_NODE_ID) return Promise.reject(new Error('node is gone'));
      const node = NODES_BY_ID[params.key];
      if (node == null) throw new Error(`unstubbed node key: ${params.key}`);
      return Promise.resolve(detailFor(node));
    }

    if (uri === '/api/nodes') {
      const parentPath = params.parentPath ?? '/';
      const list = nodesByPath[parentPath];
      if (list == null) throw new Error(`unstubbed parentPath: ${parentPath}`);
      return Promise.resolve(list);
    }

    throw new Error(`unstubbed request: ${uri}`);
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

async function openNode(user: Awaited<ReturnType<typeof renderBrowser>>['user'], name: string) {
  await user.click(within(getBrowserPage()).getByText(name));
  await waitFor(() => {
    getDetailView();
  });
}

async function switchToGrid(user: Awaited<ReturnType<typeof renderBrowser>>['user']) {
  await user.click(within(getBrowserPage()).getByRole('button', { name: 'Grid view' }));
  await waitFor(() => {
    getGrid();
  });
}

// `clearAllMocks` would leave implementations in place, letting a test inherit a stale stub.
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
});

describe('NodeBrowserPage grid view', () => {
  it('should render the table until grid view is selected', async () => {
    const { user } = await renderBrowser();

    expect(within(getBrowserPage()).getByRole('table')).toBeInTheDocument();
    expect(document.querySelector('[data-component="NodeGrid"]')).toBeNull();

    await switchToGrid(user);

    expect(within(getBrowserPage()).queryByRole('table')).toBeNull();
    expect(within(getGrid()).getByText('logo.png')).toBeInTheDocument();
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

  it('should fall back to a type icon for nodes without an image attachment', async () => {
    const { user } = await renderBrowser();
    await switchToGrid(user);

    const grid = within(getGrid());
    expect(grid.queryByAltText('report.pdf')).toBeNull();
    expect(grid.queryByAltText('photos')).toBeNull();
    expect(getGridCell('report.pdf').querySelector('.lucide-file-text')).not.toBeNull();
    expect(getGridCell('photos').querySelector('.lucide-folder')).not.toBeNull();
  });

  it('should open the detail view on a single click', async () => {
    const { user } = await renderBrowser();
    await switchToGrid(user);

    await user.click(within(getGrid()).getByText('logo.png'));

    // The wrapper mounts on selection, so only data off the loaded node proves it resolved.
    await waitFor(() => {
      expect(within(getDetailView()).getByText('logo.png title')).toBeInTheDocument();
    });
  });

  it('should descend into a folder on a single click', async () => {
    const { user } = await renderBrowser();
    await switchToGrid(user);

    await user.click(within(getGrid()).getByText('photos'));

    await waitFor(() => {
      expect(getActiveCrumb()).toHaveTextContent('photos');
    });
    expect(within(getGrid()).queryByText('logo.png')).toBeNull();
  });
});

describe('NodeBrowserPage node detail surface', () => {
  it('should replace the browse list with the detail view when a node is selected', async () => {
    const { user } = await renderBrowser();

    expect(getBrowseList()).not.toHaveAttribute('inert');

    await openNode(user, 'logo.png');

    expect(getBrowseList()).toHaveAttribute('inert');
    expect(getBrowseList()).toHaveClass('hidden');
    expect(within(getDetailView()).getByText('logo.png title')).toBeInTheDocument();
  });

  it('should keep the browse list mounted so returning to it restores scroll', async () => {
    const { user } = await renderBrowser();

    const before = getBrowseList();
    await openNode(user, 'logo.png');
    await user.click(within(getDetailView()).getByRole('button', { name: 'Back to the node list' }));

    await waitFor(() => {
      expect(getBrowseList()).not.toHaveAttribute('inert');
    });
    // A remounted container would come back at scrollTop 0.
    expect(getBrowseList()).toBe(before);
  });

  it('should make the selected node the trailing breadcrumb rather than a path segment', async () => {
    const { user } = await renderBrowser();
    await openNode(user, 'logo.png');

    await waitFor(() => {
      expect(getActiveCrumb()).toHaveTextContent('logo.png');
    });
    // A segment crumb is a button that navigates; the node is where you already are.
    expect(within(getCrumbs()).getByText('logo.png').closest('button')).toBeNull();
  });

  it('should keep the rail closed until it is toggled', async () => {
    const { user } = await renderBrowser();
    await openNode(user, 'logo.png');

    expect(document.querySelector(RAIL_SELECTOR)).toBeNull();

    await user.click(within(getDetailView()).getByRole('button', { name: 'Show siblings' }));

    await waitFor(() => {
      getRail();
    });
    expect(window.localStorage.getItem('datakit:node-rail-open')).toBe('true');
  });

  it('should persist the rail being closed again', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    const { user } = await renderBrowser();
    await openNode(user, 'logo.png');

    await waitFor(() => {
      getRail();
    });
    await user.click(within(getDetailView()).getByRole('button', { name: 'Hide siblings' }));

    await waitFor(() => {
      expect(document.querySelector(RAIL_SELECTOR)).toBeNull();
    });
    expect(window.localStorage.getItem('datakit:node-rail-open')).toBe('false');
  });

  it('should list the browsed siblings in the rail and mark only the selected one', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    const { user } = await renderBrowser();
    await openNode(user, 'logo.png');

    await waitFor(() => {
      getRail();
    });

    expect(getRailRow('report.pdf')).toBeInTheDocument();
    expect(getRailRow('photos')).toBeInTheDocument();
    expect(getRailRow('logo.png')).toHaveAttribute('data-state', 'selected');
    expect(getRailRow('report.pdf')).not.toHaveAttribute('data-state');
    expect(getRail().querySelectorAll('[data-state="selected"]')).toHaveLength(1);
  });

  it('should move the selection to the next sibling on ArrowDown', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    const { user } = await renderBrowser();
    await openNode(user, 'logo.png');
    await waitFor(() => {
      getRail();
    });

    await user.keyboard('{ArrowDown}');

    // Descending into the folder would move the breadcrumb too, so only the rail's selected
    // row tells selecting from descending apart.
    await waitFor(() => {
      expect(getRailRow('photos')).toHaveAttribute('data-state', 'selected');
    });
    expect(getRailRow('logo.png')).not.toHaveAttribute('data-state');
  });

  it('should move the selection to the previous sibling on ArrowUp', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    const { user } = await renderBrowser();
    await openNode(user, 'report.pdf');
    await waitFor(() => {
      getRail();
    });

    await user.keyboard('{ArrowUp}');

    await waitFor(() => {
      expect(getRailRow('photos')).toHaveAttribute('data-state', 'selected');
    });
  });

  it('should hold the selection at the last sibling on ArrowDown', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    const { user } = await renderBrowser();
    await openNode(user, 'report.pdf');
    await waitFor(() => {
      getRail();
    });

    await user.keyboard('{ArrowDown}');

    expect(getRailRow('report.pdf')).toHaveAttribute('data-state', 'selected');
  });

  it('should not move between siblings while a text field has focus', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    const { user } = await renderBrowser();
    await openNode(user, 'logo.png');
    await waitFor(() => {
      getRail();
    });

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    try {
      await user.keyboard('{ArrowDown}');
      expect(getRailRow('logo.png')).toHaveAttribute('data-state', 'selected');
    } finally {
      input.remove();
    }
  });

  it('should leave the selection alone while the node actions menu owns the arrow keys', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    const { user } = await renderBrowser();
    await openNode(user, 'logo.png');
    await waitFor(() => {
      getRail();
    });

    await user.click(within(getDetailView()).getByRole('button', { name: 'Node actions' }));
    await waitFor(() => {
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
    });

    await user.keyboard('{ArrowDown}');

    // Swapping the node here would retarget whatever the menu goes on to act on.
    expect(getRailRow('logo.png')).toHaveAttribute('data-state', 'selected');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('should leave the selection alone while a confirmation owns the arrow keys', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    routeApi({ '/': { nodes: [IMAGE_NODE, FOLDER_NODE, DOC_NODE], total: 3 } }, ONE_VERSION);
    const { user } = renderRoute({ initialLocation: '/repositories/my-repo/master' });
    await waitFor(() => {
      getBrowserPage();
    });
    await openNode(user, 'logo.png');
    await waitFor(() => {
      getRail();
    });

    await user.click(within(getDetailView()).getByRole('tab', { name: /^Versions/ }));
    await user.click(await within(getDetailView()).findByText('v-old'));
    await user.click(within(getDetailView()).getByRole('button', { name: 'Set as Active' }));

    const dialog = await waitFor(() => {
      const el = document.querySelector('[role="alertdialog"]');
      if (!el) throw new Error('alertdialog not found');
      return el as HTMLElement;
    });

    await user.keyboard('{ArrowDown}');

    // Otherwise confirming here would replace the content of whichever sibling the arrow reached.
    expect(getRailRow('logo.png')).toHaveAttribute('data-state', 'selected');
    expect(dialog).toHaveTextContent("'logo.png'");
  });

  it('should return to the sibling list when the rail parent row is used', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    const { user } = await renderBrowser();
    await openNode(user, 'logo.png');
    await waitFor(() => {
      getRail();
    });

    // Selected by accessible name: `..` alone announces as punctuation.
    await user.click(within(getRail()).getByRole('button', { name: 'Back to the node list' }));

    // The same destination Back and the trailing path crumb reach — not the grandparent.
    await waitFor(() => {
      expect(getBrowseList()).not.toHaveAttribute('inert');
    });
    expect(getActiveCrumb()).toHaveTextContent('master');
    expect(document.querySelector(RAIL_SELECTOR)).toBeNull();
  });

  it('should keep the close control reachable when the node fails to load', async () => {
    routeApi({ '/': { nodes: [IMAGE_NODE, FOLDER_NODE, DOC_NODE], total: 3 } });

    const { user } = renderRoute({
      initialLocation: `/repositories/my-repo/master?nodeId=${FAILING_NODE_ID}`,
    });

    await waitFor(() => {
      expect(within(getDetailView()).getByText('Failed to load node details.')).toBeInTheDocument();
    });

    await user.click(within(getDetailView()).getByRole('button', { name: 'Back to the node list' }));

    await waitFor(() => {
      expect(getBrowseList()).not.toHaveAttribute('inert');
    });
  });

  it('should rebase the browsed path onto the parent of a node opened by reference', async () => {
    window.localStorage.setItem('datakit:node-rail-open', 'true');
    routeApi({
      '/': { nodes: [IMAGE_NODE, FOLDER_NODE, DOC_NODE], total: 3 },
      '/photos': { nodes: [NESTED_NODE], total: 1 },
    });

    // `nested-1` lives under /photos but the route opens at the root — the shape a
    // Reference click produces.
    renderRoute({ initialLocation: '/repositories/my-repo/master?nodeId=nested-1' });

    await waitFor(() => {
      expect(getActiveCrumb()).toHaveTextContent('beach.jpg');
    });
    // The rail lists /photos, so the browse really moved rather than only the crumb.
    expect(getRailRow('beach.jpg')).toHaveAttribute('data-state', 'selected');
    expect(within(getRail()).queryByText('logo.png')).toBeNull();
  });
});
