// @vitest-environment jsdom

import { render, type RenderResult, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  NodeDetail,
  NodeBinaryDetail,
} from '../../../../../main/resources/assets/js/lib/api/nodes';
import type { ReactElement } from 'react';

vi.mock('../../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => ({
    appId: 'com.enonic.app.datakit',
    assetsUri: '/assets',
    toolUri: '/',
    apiUris: { binary: '/api/binary' },
    launcherUri: '/launcher',
    user: { key: 'user:system:su', displayName: 'Super User' },
  })),
}));

import { NodePropertiesTab } from '../../../../../main/resources/assets/js/components/node-properties/node-properties-tab';
import { TooltipProvider } from '../../../../../main/resources/assets/js/components/ui/tooltip';

const REFERENCE_ID = '7b3f1c22-1234-4a56-8b90-abcdefabcdef';

function buildSystemKeys(): NodeDetail {
  return {
    _id: 'node-1',
    _name: 'article',
    _path: '/content/article',
    _nodeType: 'content',
    _childOrder: '_ts DESC',
    _ts: '2026-08-30T10:15:00Z',
    _state: 'DEFAULT',
    _versionKey: 'version-1',
    _permissions: [],
  };
}

function buildNode(properties?: Record<string, unknown>): NodeDetail {
  return {
    ...buildSystemKeys(),
    ...(properties ?? {
      displayName: 'Article',
      data: {
        hero: { caption: 'Sunset' },
        tags: ['alpha', 'beta'],
        author: REFERENCE_ID,
      },
    }),
  };
}

type TabProps = {
  node?: NodeDetail;
  binary?: NodeBinaryDetail;
  onNavigateToNode?: (nodeId: string) => void;
};

function tabElement(props?: TabProps): ReactElement {
  return (
    <TooltipProvider delayDuration={0}>
      <NodePropertiesTab
        node={props?.node ?? buildNode()}
        repoId="com.enonic.cms.default"
        branch="draft"
        binary={props?.binary}
        onNavigateToNode={props?.onNavigateToNode}
      />
    </TooltipProvider>
  );
}

function renderTab(props?: TabProps): RenderResult {
  return render(tabElement(props));
}

function rowFor(path: string): HTMLElement {
  const cell = screen.getByTitle(path);
  const row = cell.closest('tr');
  if (row == null) throw new Error(`no row for ${path}`);
  return row;
}

describe('NodePropertiesTab', () => {
  it('renders nested set members as their own rows', () => {
    renderTab();

    expect(within(rowFor('data.hero.caption')).getByText('Sunset')).toBeInTheDocument();
  });

  it('hides system keys and shows the empty state when nothing is left', () => {
    renderTab({ node: buildSystemKeys() });

    expect(screen.getByText('No user properties')).toBeInTheDocument();
    expect(screen.queryByTitle('_path')).toBeNull();
  });

  it('labels array elements by index rather than by name', () => {
    renderTab();

    // An element's name is its index as a string, so asserting the text alone passes on
    // either branch; the name span carries title={path} and the index badge does not.
    for (const [index, value] of [
      ['0', 'alpha'],
      ['1', 'beta'],
    ] as const) {
      const row = screen.getByText(value).closest('tr') as HTMLElement;
      expect(within(row).getByText(index)).toBeInTheDocument();
      expect(within(row).queryByTitle(`data.tags[${index}]`)).toBeNull();
    }
  });

  it('collapses a container and hides its descendants', async () => {
    const user = userEvent.setup();
    renderTab();

    expect(screen.queryByTitle('data.hero.caption')).not.toBeNull();
    await user.click(screen.getByLabelText('Collapse data.hero'));
    expect(screen.queryByTitle('data.hero.caption')).toBeNull();

    await user.click(screen.getByLabelText('Expand data.hero'));
    expect(screen.queryByTitle('data.hero.caption')).not.toBeNull();
  });

  it('shows a child count in place of a value for containers', () => {
    renderTab();

    expect(within(rowFor('data.tags')).getByText('2 items')).toBeInTheDocument();
    expect(within(rowFor('data.hero')).getByText('1 property')).toBeInTheDocument();
  });

  it('marks an inferred type distinctly from a certain one', () => {
    renderTab();

    expect(within(rowFor('data.author')).getByText('Reference')).toBeInTheDocument();
    expect(within(rowFor('data.author')).getByText('?')).toBeInTheDocument();
    expect(within(rowFor('displayName')).getByText('String')).toBeInTheDocument();
    expect(within(rowFor('displayName')).queryByText('?')).toBeNull();
  });

  it('reaches the inferred-type explanation by keyboard, named by its visible label', async () => {
    renderTab();

    const badge = within(rowFor('data.author')).getByText('Reference');
    expect(badge).toHaveAttribute('tabindex', '0');

    badge.focus();
    expect(document.activeElement).toBe(badge);

    // A duplicate aria-label would displace the visible label and be announced twice.
    expect(badge).not.toHaveAttribute('aria-label');
    const tip = await screen.findByRole('tooltip');
    expect(badge).toHaveAttribute('aria-describedby', tip.id);
  });

  it('explains an inferred type on hover', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.hover(within(rowFor('data.author')).getByText('Reference'));

    // Radix renders the content twice: the visible popper and a visually-hidden copy.
    const tip = await screen.findByRole('tooltip');
    expect(
      within(tip).getByText(
        'Inferred as Reference — XP returns a plain value, so the real type cannot be read here',
      ),
    ).toBeInTheDocument();
  });

  it('reports the binary mime type and a human-readable size on hover', async () => {
    const user = userEvent.setup();
    renderTab({
      node: buildNode({ data: { media: { attachment: 'logo.png' } } }),
      binary: { binaryReference: 'logo.png', mimeType: 'image/png', size: 2048 },
    });

    await user.hover(screen.getByLabelText('Download attachment'));

    const tip = await screen.findByRole('tooltip');
    expect(within(tip).getByText('image/png')).toBeInTheDocument();
    expect(within(tip).getByText('2.0 KB')).toBeInTheDocument();
  });

  it('re-evaluates default expansion when the panel switches to another node', async () => {
    const user = userEvent.setup();
    const small = { data: { tags: ['alpha', 'beta'] } };
    const big = {
      data: { tags: Array.from({ length: 25 }, (_, i) => `tag-${i}`) },
    };

    const { rerender } = renderTab({ node: buildNode(small) });
    expect(screen.getByText('alpha')).toBeInTheDocument();

    // Same node id would be the same node; navigation swaps identity.
    rerender(tabElement({ node: { ...buildNode(big), _id: 'node-2' } }));

    // Over LARGE_COLLECTION_SIZE, so it must start collapsed despite the previous node's
    // `data.tags` being expanded.
    expect(screen.queryByText('tag-0')).toBeNull();
    await user.click(screen.getByLabelText('Expand data.tags'));
    expect(screen.getByText('tag-0')).toBeInTheDocument();
  });

  it('navigates from a reference nested inside a set', async () => {
    const user = userEvent.setup();
    const onNavigateToNode = vi.fn();
    renderTab({ onNavigateToNode });

    await user.click(screen.getByRole('button', { name: REFERENCE_ID }));

    expect(onNavigateToNode).toHaveBeenCalledWith(REFERENCE_ID);
  });

  it('offers a download link on a nested binary reference', () => {
    renderTab({
      node: buildNode({ data: { media: { attachment: 'logo.png' } } }),
      binary: { binaryReference: 'logo.png', mimeType: 'image/png', size: 2048 },
    });

    const link = screen.getByLabelText('Download attachment') as HTMLAnchorElement;
    const params = new URL(link.href, 'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      repoId: 'com.enonic.cms.default',
      branch: 'draft',
      key: 'node-1',
      binaryReference: 'logo.png',
    });
    expect(link.hasAttribute('download')).toBe(true);
  });
});
