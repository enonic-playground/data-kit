import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/io', () => ({
  getMimeType: vi.fn(),
  getSize: vi.fn(),
}));

import { getMimeType, getSize } from '/lib/xp/io';

import { resolveNodeImage } from '../../main/resources/lib/node-image';

const mockedGetMimeType = vi.mocked(getMimeType);
const mockedGetSize = vi.mocked(getSize);

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

function byExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

function createRepo(available: string[] = []) {
  return {
    getBinary: vi.fn(({ binaryReference }: { key: string; binaryReference: string }) => {
      if (!available.includes(binaryReference)) throw new Error('no such binary');
      return { _bytes: true } as never;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetMimeType.mockImplementation(byExtension);
  mockedGetSize.mockReturnValue(2048);
});

describe('resolveNodeImage', () => {
  test('resolves a top-level binary reference that names an image', () => {
    const repo = createRepo(['photo.png']);

    const image = resolveNodeImage(repo, { _id: 'node-1', media: 'photo.png' });

    expect(image).toEqual({ binaryReference: 'photo.png', mimeType: 'image/png' });
    expect(repo.getBinary).toHaveBeenCalledWith({ key: 'node-1', binaryReference: 'photo.png' });
  });

  test('resolves a reference nested inside a property set', () => {
    const repo = createRepo(['nested.jpg']);

    const image = resolveNodeImage(repo, {
      _id: 'node-1',
      data: { media: { attachment: 'nested.jpg' } },
    });

    expect(image?.binaryReference).toBe('nested.jpg');
    expect(image?.mimeType).toBe('image/jpeg');
  });

  test('returns undefined when no property names an image', () => {
    const repo = createRepo(['doc.pdf']);

    expect(resolveNodeImage(repo, { _id: 'node-1', file: 'doc.pdf', note: 'hello' })).toBeUndefined();
    expect(repo.getBinary).not.toHaveBeenCalled();
  });

  test('returns undefined when the candidate is not a real binary', () => {
    const repo = createRepo([]);

    expect(resolveNodeImage(repo, { _id: 'node-1', caption: 'see diagram.png' })).toBeUndefined();
    expect(repo.getBinary).toHaveBeenCalled();
  });

  test('keeps looking after a candidate the repository rejects', () => {
    const repo = createRepo(['real.png']);

    const image = resolveNodeImage(repo, {
      _id: 'node-1',
      caption: 'cropped from banner.png',
      data: { media: { attachment: 'real.png' } },
    });

    expect(image?.binaryReference).toBe('real.png');
  });

  test('stops probing once a candidate resolves', () => {
    const repo = createRepo(['first.png']);

    const image = resolveNodeImage(repo, {
      _id: 'node-1',
      media: 'first.png',
      gallery: ['second.png', 'third.png'],
    });

    expect(image?.binaryReference).toBe('first.png');
    expect(repo.getBinary).toHaveBeenCalledTimes(1);
  });

  test('finds the real attachment behind more decoys than the old candidate cap allowed', () => {
    const decoys = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'];
    const repo = createRepo(['real.png']);

    const image = resolveNodeImage(repo, {
      _id: 'node-1',
      gallery: decoys,
      media: { attachment: 'real.png' },
    });

    expect(image?.binaryReference).toBe('real.png');
  });

  test('gives up after the probe budget rather than hammering the repository', () => {
    const decoys = Array.from({ length: 40 }, (_unused, i) => `decoy-${i}.png`);
    const repo = createRepo(['real.png']);

    const image = resolveNodeImage(repo, {
      _id: 'node-1',
      gallery: decoys,
      media: { attachment: 'real.png' },
    });

    expect(image).toBeUndefined();
    expect(repo.getBinary).toHaveBeenCalledTimes(8);
  });

  test('does not cross into getMimeType for strings that cannot name an image', () => {
    const repo = createRepo(['photo.png']);

    resolveNodeImage(repo, {
      _id: 'node-1',
      body: ['plain text', 'more text', 'even more'],
      media: 'photo.png',
    });

    expect(mockedGetMimeType.mock.calls.map((call) => call[0])).toEqual(['photo.png', 'photo.png']);
  });

  test('terminates on a self-referencing array instead of recursing forever', () => {
    const repo = createRepo(['real.png']);
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    cyclic.push('real.png');

    // The visit budget is what ends this; the node loses its image rather than the
    // request losing its stack. Repository data is a tree, so this is a guard, not a case.
    expect(() => resolveNodeImage(repo, { _id: 'node-1', list: cyclic })).not.toThrow();
    expect(resolveNodeImage(repo, { _id: 'node-1', list: cyclic })).toBeUndefined();
  });

  test('resolves a multi-valued property at the same depth as a single-valued one', () => {
    const repo = createRepo(['kitten.jpg']);

    const single = resolveNodeImage(repo, {
      _id: 'node-1',
      data: { media: { attachment: 'kitten.jpg' } },
    });
    const multi = resolveNodeImage(repo, {
      _id: 'node-1',
      data: { media: { attachment: ['kitten.jpg'] } },
    });

    expect(single?.binaryReference).toBe('kitten.jpg');
    expect(multi).toEqual(single);
  });

  test('ignores system properties so a node id never becomes a candidate', () => {
    const repo = createRepo(['sneaky.png']);

    expect(resolveNodeImage(repo, { _id: 'node-1', _name: 'sneaky.png' })).toBeUndefined();
    expect(repo.getBinary).not.toHaveBeenCalled();
  });

  test('stops descending past the depth cap', () => {
    const repo = createRepo(['deep.png']);

    const image = resolveNodeImage(repo, {
      _id: 'node-1',
      a: { b: { c: { d: 'deep.png' } } },
    });

    expect(image).toBeUndefined();
  });
});
