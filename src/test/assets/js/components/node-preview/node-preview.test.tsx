// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactElement } from 'react';

vi.mock('../../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => ({
    apiUris: { nodes: '/api/nodes', binary: '/api/binary' },
  })),
}));

import type { NodeBinaryDetail } from '../../../../../main/resources/assets/js/lib/api/nodes';

import { NodePreview } from '../../../../../main/resources/assets/js/components/node-preview/node-preview';

const BASE = {
  repoId: 'my-repo',
  branch: 'master',
  nodeId: 'node-1',
  nodeName: 'my-content',
  versionKey: 'v1',
};

function buildBinary(overrides?: Partial<NodeBinaryDetail>): NodeBinaryDetail {
  return {
    binaryReference: 'logo.png',
    mimeType: 'image/png',
    size: 2048,
    ...overrides,
  };
}

function renderPreview(binary: NodeBinaryDetail): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <NodePreview {...BASE} binary={binary} />
    </QueryClientProvider>
  );
  render(<Wrapper />);
}

function stubBinaryBody(text: string) {
  const encoded = new TextEncoder().encode(text);
  let sent = false;
  const spy = vi.fn(() =>
    Promise.resolve({
      ok: true,
      body: {
        getReader: () => ({
          read: () => {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: encoded });
          },
          cancel: () => Promise.resolve(),
        }),
      },
    }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

function getPreview(): HTMLElement {
  const el = document.querySelector('[data-component="NodePreview"]');
  if (!el) throw new Error('NodePreview not found');
  return el as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('NodePreview detail strip', () => {
  it('should describe the binary regardless of which view renders it', () => {
    renderPreview(buildBinary({ binaryReference: 'archive.zip', mimeType: 'application/zip' }));

    const strip = document.querySelector('[data-component="BinaryDetailStrip"]') as HTMLElement;
    expect(within(strip).getByText('archive.zip')).toBeInTheDocument();
    expect(within(strip).getByText('application/zip')).toBeInTheDocument();
    expect(within(strip).getByText('2.0 KB')).toBeInTheDocument();
  });

  it('should offer a download pointing at the binary, not the inline preview', () => {
    renderPreview(buildBinary());

    const link = within(getPreview()).getByRole('link', { name: 'Download' }) as HTMLAnchorElement;
    const params = new URL(link.href, 'http://localhost').searchParams;

    expect(params.get('binaryReference')).toBe('logo.png');
    expect(params.get('inline')).toBeNull();
  });

  it('should render before dimensions arrive rather than holding the preview back', () => {
    renderPreview(buildBinary());

    // The strip is up with no dimensions yet; the image has not fired onLoad, and jsdom
    // never will. Reading "not yet" as "never" would block the whole preview on it.
    expect(screen.getByText('logo.png')).toBeInTheDocument();
    expect(screen.queryByText(/px$/)).toBeNull();
  });

  it('should report dimensions once the image reports them', async () => {
    renderPreview(buildBinary());

    const img = within(getPreview()).getByAltText('my-content');
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    img.dispatchEvent(new Event('load', { bubbles: false }));

    expect(await screen.findByText('800 x 600 px')).toBeInTheDocument();
  });

  it('should not carry dimensions from one binary onto another', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ binary }: { binary: NodeBinaryDetail }): ReactElement => (
      <QueryClientProvider client={queryClient}>
        <NodePreview
          key={`${BASE.versionKey}:${binary.binaryReference}`}
          {...BASE}
          binary={binary}
        />
      </QueryClientProvider>
    );

    const { rerender } = render(<Wrapper binary={buildBinary()} />);
    const first = within(getPreview()).getByAltText('my-content');
    Object.defineProperty(first, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(first, 'naturalHeight', { value: 600, configurable: true });
    first.dispatchEvent(new Event('load', { bubbles: false }));
    expect(await screen.findByText('800 x 600 px')).toBeInTheDocument();

    // The same node, a different version's binary — the strip must not keep 800 x 600.
    rerender(<Wrapper binary={buildBinary({ binaryReference: 'other.png', size: 4096 })} />);

    await waitFor(() => {
      expect(screen.queryByText('800 x 600 px')).toBeNull();
    });
  });

  it('should ignore a load that reports no dimensions', () => {
    renderPreview(buildBinary());

    const img = within(getPreview()).getByAltText('my-content');
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 0, configurable: true });
    img.dispatchEvent(new Event('load', { bubbles: false }));

    expect(screen.queryByText(/px$/)).toBeNull();
  });
});

describe('NodePreview view selection', () => {
  it('should render an image branch for an image mime type', () => {
    renderPreview(buildBinary());

    const img = within(getPreview()).getByAltText('my-content') as HTMLImageElement;
    expect(new URL(img.src, 'http://localhost').searchParams.get('inline')).toBe('true');
    expect(document.querySelector('[data-component="BinaryFileCard"]')).toBeNull();
  });

  it('should embed a PDF rather than falling back to the file card', () => {
    renderPreview(buildBinary({ binaryReference: 'manual.pdf', mimeType: 'application/pdf' }));

    const object = getPreview().querySelector('object');
    expect(object).not.toBeNull();
    expect(object).toHaveAttribute('type', 'application/pdf');
    // The card is the <object>'s fallback child, so it is present but only shown by a
    // browser that refuses the embed.
    expect(object?.querySelector('[data-component="BinaryFileCard"]')).not.toBeNull();
  });

  it.each([
    ['notes.txt', 'text/plain'],
    ['config.json', 'application/json'],
    ['feed.xml', 'application/xml'],
  ])('should read %s as text', async (binaryReference, mimeType) => {
    stubBinaryBody('first line');
    renderPreview(buildBinary({ binaryReference, mimeType }));

    expect(await screen.findByText('first line')).toBeInTheDocument();
  });

  it.each([
    ['archive.zip', 'application/zip'],
    ['clip.mp4', 'video/mp4'],
    ['blob.bin', 'application/octet-stream'],
  ])('should fall back to a file card for %s', (binaryReference, mimeType) => {
    renderPreview(buildBinary({ binaryReference, mimeType }));

    const card = document.querySelector('[data-component="BinaryFileCard"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByText(binaryReference)).toBeInTheDocument();
    expect(getPreview().querySelector('object')).toBeNull();
    expect(within(getPreview()).queryByAltText('my-content')).toBeNull();
  });

  it('should key the text cache on the binary, not just the node version', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ binary }: { binary: NodeBinaryDetail }): ReactElement => (
      <QueryClientProvider client={queryClient}>
        <NodePreview {...BASE} binary={binary} />
      </QueryClientProvider>
    );

    stubBinaryBody('contents of the first file');
    const { rerender } = render(<Wrapper binary={buildBinary({ binaryReference: 'a.txt', mimeType: 'text/plain' })} />);
    await screen.findByText('contents of the first file');

    // Same node and version, a different binary: an incomplete key would serve the
    // first file's text under the second file's name.
    stubBinaryBody('contents of the second file');
    rerender(<Wrapper binary={buildBinary({ binaryReference: 'b.txt', mimeType: 'text/plain' })} />);

    expect(await screen.findByText('contents of the second file')).toBeInTheDocument();
  });

  it('should not fetch the body for a binary it will not render as text', () => {
    const spy = stubBinaryBody('should never be read');
    renderPreview(buildBinary({ binaryReference: 'archive.zip', mimeType: 'application/zip' }));

    expect(spy).not.toHaveBeenCalled();
  });

  it('should say so when the text body cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 500, body: null })),
    );
    renderPreview(buildBinary({ binaryReference: 'notes.txt', mimeType: 'text/plain' }));

    expect(await screen.findByText('Failed to read the binary')).toBeInTheDocument();
  });

  it('should warn when the text body was cut at the cap', async () => {
    const oversized = 'x'.repeat(256 * 1024 + 1);
    stubBinaryBody(oversized);
    renderPreview(buildBinary({ binaryReference: 'server.log', mimeType: 'text/plain' }));

    expect(await screen.findByText('Showing the first 256.0 KB of this file')).toBeInTheDocument();
  });

  it('should not warn when the text body fit', async () => {
    stubBinaryBody('short enough');
    renderPreview(buildBinary({ binaryReference: 'notes.txt', mimeType: 'text/plain' }));

    await screen.findByText('short enough');
    await waitFor(() => {
      expect(screen.queryByText(/Showing the first/)).toBeNull();
    });
  });
});
