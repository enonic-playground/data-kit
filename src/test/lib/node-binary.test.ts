import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/io', () => ({
  getMimeType: vi.fn(),
  getSize: vi.fn(),
}));

import { getMimeType, getSize } from '/lib/xp/io';

import { resolveNodeBinary, resolveNodeImage } from '../../main/resources/lib/node-binary';

const mockedGetMimeType = vi.mocked(getMimeType);

/** Mirrors MAX_PROBES in the module under test. */
const MAX_PROBES = 8;
const mockedGetSize = vi.mocked(getSize);

// XP's MediaTypes map, verbatim: a fixed table, and it does NOT lowercase the extension
// before looking it up. Inventing entries here (zip, docx, csv) would make the suite
// agree with a mime map that does not exist, so the list stays exactly what ships.
const MIME_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  bmp: 'image/bmp',
  ico: 'image/vnd.microsoft.icon',
  webp: 'image/webp',
  avif: 'image/avif',
  apng: 'image/apng',
  pdf: 'application/pdf',
  json: 'application/json',
  jsonld: 'application/ld+json',
  webmanifest: 'application/manifest+json',
  js: 'text/javascript',
  es: 'text/javascript',
  es6: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  htm: 'text/html',
  html: 'text/html',
  xml: 'text/xml',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  ics: 'text/calendar',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mpeg: 'video/mpeg',
  oga: 'audio/ogg',
  ogv: 'video/ogg',
  weba: 'audio/webm',
  webm: 'video/webm',
  flac: 'audio/flac',
  woff: 'font/woff',
  woff2: 'font/woff2',
  eot: 'application/vnd.ms-fontobject',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

function byExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  // No `.toLowerCase()` — XP does not do one, and the resolver is what has to cope.
  return MIME_BY_EXTENSION[name.slice(dot + 1)] ?? 'application/octet-stream';
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

describe('resolveNodeBinary', () => {
  test('resolves a top-level binary reference', () => {
    const repo = createRepo(['photo.png']);

    const binary = resolveNodeBinary(repo, { _id: 'node-1', media: 'photo.png' });

    expect(binary).toEqual({ binaryReference: 'photo.png', mimeType: 'image/png' });
    expect(repo.getBinary).toHaveBeenCalledWith({ key: 'node-1', binaryReference: 'photo.png' });
  });

  test('resolves a reference nested inside a property set', () => {
    const repo = createRepo(['nested.jpg']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      data: { media: { attachment: 'nested.jpg' } },
    });

    expect(binary?.binaryReference).toBe('nested.jpg');
    expect(binary?.mimeType).toBe('image/jpeg');
  });

  test.each([
    ['report.pdf', 'application/pdf'],
    ['notes.txt', 'text/plain'],
    ['config.json', 'application/json'],
    ['bundle.zip', 'application/octet-stream'],
  ])('resolves %s, which the image-only resolver rejects', (name, mimeType) => {
    const repo = createRepo([name]);
    const node = { _id: 'node-1', file: name };

    expect(resolveNodeBinary(repo, node)).toEqual({ binaryReference: name, mimeType });
    expect(resolveNodeImage(repo, node)).toBeUndefined();
  });

  test('returns undefined when no property names a binary', () => {
    const repo = createRepo(['doc.pdf']);

    expect(resolveNodeBinary(repo, { _id: 'node-1', note: 'hello' })).toBeUndefined();
    expect(repo.getBinary).not.toHaveBeenCalled();
  });

  test('returns undefined when the candidate is not a real binary', () => {
    const repo = createRepo([]);

    expect(resolveNodeBinary(repo, { _id: 'node-1', file: 'diagram.png' })).toBeUndefined();
    expect(repo.getBinary).toHaveBeenCalled();
  });

  test.each(['product photo.jpg', 'My Report 2026.pdf', 'notes.properties'])(
    'resolves %s, whose name a stricter filter would have excluded',
    (name) => {
      const repo = createRepo([name]);

      expect(resolveNodeBinary(repo, { _id: 'node-1', media: name })?.binaryReference).toBe(name);
    },
  );

  test.each(['just some prose', 'a/path/to/thing.png', 'line one\nline two.txt', 'README'])(
    'does not spend a probe on %j',
    (value) => {
      const repo = createRepo([]);

      resolveNodeBinary(repo, { _id: 'node-1', field: value });

      expect(repo.getBinary).not.toHaveBeenCalled();
    },
  );

  test('keeps looking after a candidate the repository rejects', () => {
    const repo = createRepo(['real.png']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      thumbnail: 'missing.png',
      data: { media: { attachment: 'real.png' } },
    });

    expect(binary?.binaryReference).toBe('real.png');
    expect(repo.getBinary).toHaveBeenCalledTimes(2);
  });

  test('stops probing once a candidate resolves', () => {
    const repo = createRepo(['first.png']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      media: 'first.png',
      gallery: ['second.png', 'third.png'],
    });

    expect(binary?.binaryReference).toBe('first.png');
    expect(repo.getBinary).toHaveBeenCalledTimes(1);
  });

  test('resolves a binary sitting behind six decoys, inside the probe budget', () => {
    const decoys = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'];
    const repo = createRepo(['real.png']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      gallery: decoys,
      media: { attachment: 'real.png' },
    });

    expect(binary?.binaryReference).toBe('real.png');
  });

  test('gives up after the probe budget rather than hammering the repository', () => {
    const decoys = Array.from({ length: 40 }, (_unused, i) => `decoy-${i}.png`);
    const repo = createRepo(['real.png']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      gallery: decoys,
      media: { attachment: 'real.png' },
    });

    expect(binary).toBeUndefined();
    expect(repo.getBinary).toHaveBeenCalledTimes(8);
  });

  test('does not cross into getMimeType for strings that cannot name a binary', () => {
    const repo = createRepo(['photo.png']);

    resolveNodeBinary(repo, {
      _id: 'node-1',
      body: ['plain text', 'more text', 'even more'],
      media: 'photo.png',
    });

    expect(mockedGetMimeType.mock.calls.map((call) => call[0])).toEqual(['photo.png']);
  });

  test('gives up after the visit budget rather than walking an unbounded node', () => {
    // Wide, not deep: nothing here throws, so only the visit budget can end the walk.
    // Without it the last property resolves, which is what makes this fail on its own.
    const repo = createRepo(['real.png']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      filler: Array.from({ length: 5000 }, () => 'not a filename'),
      media: 'real.png',
    });

    expect(binary).toBeUndefined();
  });

  test('does not let a self-referencing array escape as an exception', () => {
    const repo = createRepo(['real.png']);
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    cyclic.push('real.png');

    // Repository data is a tree, so this is a guard, not a case. The budget above is
    // what bounds the walk; this only pins that the caller sees a value, not a throw.
    expect(resolveNodeBinary(repo, { _id: 'node-1', list: cyclic })).toBeUndefined();
  });

  test('resolves a multi-valued property at the same depth as a single-valued one', () => {
    const repo = createRepo(['kitten.jpg']);

    const single = resolveNodeBinary(repo, {
      _id: 'node-1',
      data: { media: { attachment: 'kitten.jpg' } },
    });
    const multi = resolveNodeBinary(repo, {
      _id: 'node-1',
      data: { media: { attachment: ['kitten.jpg'] } },
    });

    expect(single?.binaryReference).toBe('kitten.jpg');
    expect(multi).toEqual(single);
  });

  test('skips underscore-prefixed system properties', () => {
    const repo = createRepo(['sneaky.png']);

    expect(resolveNodeBinary(repo, { _id: 'node-1', _name: 'sneaky.png' })).toBeUndefined();
    expect(repo.getBinary).not.toHaveBeenCalled();
  });

  test('stops descending past the depth cap', () => {
    const repo = createRepo(['deep.png']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      a: { b: { c: { d: 'deep.png' } } },
    });

    expect(binary).toBeUndefined();
  });
});

describe('resolveNodeImage', () => {
  test('skips a non-image without spending a probe on it', () => {
    const repo = createRepo(['doc.pdf', 'photo.png']);

    const image = resolveNodeImage(repo, {
      _id: 'node-1',
      attachment: 'doc.pdf',
      data: { media: 'photo.png' },
    });

    expect(image?.binaryReference).toBe('photo.png');
    expect(repo.getBinary).toHaveBeenCalledTimes(1);
  });

  test('returns undefined for a node whose only binary is not an image', () => {
    const repo = createRepo(['doc.pdf']);

    expect(resolveNodeImage(repo, { _id: 'node-1', file: 'doc.pdf' })).toBeUndefined();
    expect(repo.getBinary).not.toHaveBeenCalled();
  });
});

describe('resolveNodeBinary probe budget against prose', () => {
  test('finds the attachment on the first probe despite eight prose decoys', () => {
    const repo = createRepo(['press-kit.pdf']);

    const binary = resolveNodeBinary(repo, {
      _id: 'doc-2',
      data: {
        a: 'Mirror of the 2019 release, see legacy.zip',
        b: 'Source bundle: sources.tar.gz',
        c: 'Homepage: acme.com',
        d: 'press@acme.com',
        e: 'schema version 2.0',
        f: 'com.acme.pressroom',
        g: 'Contact form at acme.com contact.html',
        h: 'See also the appendix.docx',
        media: { attachment: 'press-kit.pdf' },
      },
    });

    expect(binary).toEqual({ binaryReference: 'press-kit.pdf', mimeType: 'application/pdf' });
    expect(repo.getBinary).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a path', 'assets/img/logo.png'],
    ['a newline', 'line one\nline two.txt'],
    ['a leading space', ' spaced.png'],
    ['no extension at all', 'README'],
  ])('does not spend a probe on %s', (_label, value) => {
    const repo = createRepo([]);

    resolveNodeBinary(repo, { _id: 'node-1', field: value });

    expect(repo.getBinary).not.toHaveBeenCalled();
  });

  test.each([
    ['an address', 'press@acme.com'],
    ['an application key', 'com.acme.pressroom'],
    ['a version number', 'schema version 2.0'],
  ])('probes %s only after a real attachment', (_label, decoy) => {
    const repo = createRepo(['press-kit.pdf']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      a: decoy,
      media: { attachment: 'press-kit.pdf' },
    });

    expect(binary?.binaryReference).toBe('press-kit.pdf');
    expect(repo.getBinary).toHaveBeenCalledTimes(1);
  });

  test('costs a text-only node almost nothing, and never the whole budget', () => {
    const repo = createRepo([]);
    const site = {
      _id: 'site-1',
      data: {
        description: 'Read the launch notes at example.com',
        siteConfig: [
          { applicationKey: 'com.acme.pressroom' },
          { applicationKey: 'com.enonic.app.datakit' },
        ],
      },
    };

    expect(resolveNodeBinary(repo, site)).toBeUndefined();
    // Strings shaped like names cannot be ruled out without asking the repository, so a
    // few probes is the floor. What matters is that it is a few and not the whole budget,
    // which is what would strand a real attachment sitting behind them.
    expect(repo.getBinary.mock.calls.length).toBeLessThan(MAX_PROBES);
  });

  test('costs the grid nothing for a node with no image', () => {
    const repo = createRepo([]);

    const image = resolveNodeImage(repo, {
      _id: 'site-1',
      data: {
        description: 'Read the launch notes at example.com',
        siteConfig: [{ applicationKey: 'com.acme.pressroom' }],
      },
    });

    // `images=true` runs this per node on the browse list, so a text property must not
    // reach the repository at all.
    expect(image).toBeUndefined();
    expect(repo.getBinary).not.toHaveBeenCalled();
  });

  test('falls back to a spaced name when nothing space-free resolves', () => {
    const repo = createRepo(['product photo.jpg']);

    const binary = resolveNodeBinary(repo, {
      _id: 'node-1',
      caption: 'shot for the launch, see brand.zip',
      media: 'product photo.jpg',
    });

    expect(binary?.binaryReference).toBe('product photo.jpg');
  });
});

describe('resolveNodeBinary candidate shapes', () => {
  test.each(['logo@2x.png', 'archive.7z', 'clip.3gp', 'product photo.jpg', 'My Report.pdf'])(
    'resolves %s, which the repository is the authority on',
    (name) => {
      const repo = createRepo([name]);

      expect(resolveNodeBinary(repo, { _id: 'n', media: name })?.binaryReference).toBe(name);
    },
  );

  test('resolves a binary whose extension names no known type', () => {
    const repo = createRepo(['firmware.bin']);

    // The file card exists to render exactly this, so discovery must not drop it.
    expect(resolveNodeBinary(repo, { _id: 'n', media: 'firmware.bin' })).toEqual({
      binaryReference: 'firmware.bin',
      mimeType: 'application/octet-stream',
    });
  });

  test('prefers a typed name over an untyped one', () => {
    const repo = createRepo(['blob.bin', 'report.pdf']);

    const binary = resolveNodeBinary(repo, {
      _id: 'n',
      a: 'blob.bin',
      b: 'report.pdf',
    });

    expect(binary?.binaryReference).toBe('report.pdf');
    expect(repo.getBinary).toHaveBeenCalledTimes(1);
  });

  test('still probes what it collected when the walk throws partway', () => {
    const repo = createRepo(['real.png']);
    const node = { _id: 'n', first: 'real.png' };
    Object.defineProperty(node, 'later', {
      enumerable: true,
      get() {
        throw new Error('property blew up');
      },
    });

    // A throw after a candidate was already seen must not discard it — the old walk
    // confirmed as it went, so a late failure could not lose an early hit.
    expect(resolveNodeBinary(repo, node)?.binaryReference).toBe('real.png');
  });
});

describe('resolveNodeBinary against XP\'s narrow mime map', () => {
  // ! XP types ~38 extensions. Everything else is octet-stream, so rejecting on that
  // ! would hide the Preview tab for most real attachments.
  test.each([
    'annual-report.docx',
    'press-kit.zip',
    'export.csv',
    'server.log',
    'backup.tar.gz',
    'clip.mov',
    'artwork.psd',
    'budget.xlsx',
    'notes.md',
    'config.yaml',
    'firmware.bin',
  ])('resolves %s, which XP cannot type', (name) => {
    const repo = createRepo([name]);

    expect(resolveNodeBinary(repo, { _id: 'n', data: { attachment: name } })).toEqual({
      binaryReference: name,
      mimeType: 'application/octet-stream',
    });
  });

  test.each([
    ['IMG_1234.JPG', 'image/jpeg'],
    ['Logo.PNG', 'image/png'],
    ['brochure.PDF', 'application/pdf'],
  ])('types %s despite the uppercase extension', (name, mimeType) => {
    const repo = createRepo([name]);

    expect(resolveNodeBinary(repo, { _id: 'n', media: name })).toEqual({
      binaryReference: name,
      mimeType,
    });
  });

  test('reaches a spaced name behind a full run of plain ones', () => {
    // Every decoy is typeable and plain, so all of them outrank the real attachment.
    // Without a reserve the bare pass would spend the budget and never reach it.
    const repo = createRepo(['product photo.jpg']);

    const binary = resolveNodeBinary(repo, {
      _id: 'n',
      data: {
        attachment: 'product photo.jpg',
        s1: 'bundle.js',
        s2: 'main.css',
        s3: 'index.html',
        s4: 'schema.json',
        s5: 'robots.txt',
        s6: 'sitemap.xml',
        s7: 'icon.svg',
        s8: 'intro.mp4',
      },
    });

    expect(binary).toEqual({ binaryReference: 'product photo.jpg', mimeType: 'image/jpeg' });
  });
});

describe('resolveNodeImage cost on the browse list', () => {
  test('stops at the first hit instead of walking the whole node', () => {
    const repo = createRepo(['hit.png']);
    const prose: Record<string, unknown> = { aa: 'hit.png' };
    for (let i = 0; i < 50; i += 1) prose[`p${i}`] = `see the notes at example.com`;

    const image = resolveNodeImage(repo, { _id: 'n', data: prose });

    expect(image?.binaryReference).toBe('hit.png');
    // `images=true` runs this once per row, so the walk must not price every string.
    expect(mockedGetMimeType).toHaveBeenCalledTimes(1);
  });

  test('prices nothing on a node of pure prose', () => {
    const prose: Record<string, unknown> = {};
    for (let i = 0; i < 50; i += 1) prose[`p${i}`] = 'see the notes at example.com';
    const repo = createRepo([]);

    expect(resolveNodeImage(repo, { _id: 'n', data: prose })).toBeUndefined();
    expect(mockedGetMimeType).not.toHaveBeenCalled();
    expect(repo.getBinary).not.toHaveBeenCalled();
  });

  test('spends at most the probe budget on prose that ends in an image name', () => {
    const repo = createRepo([]);

    const image = resolveNodeImage(repo, {
      _id: 'n',
      description: 'Cropped from banner.png by the design team',
      credit: 'Original artwork: hero shot.jpg',
      note: 'Also see logo.png in the brand kit',
    });

    // A sentence ending in an image name is indistinguishable from a name with spaces,
    // so it costs a probe — as it always has. What is pinned is that the cost is bounded
    // and only the strings actually ending in an image extension pay it.
    expect(image).toBeUndefined();
    expect(repo.getBinary).toHaveBeenCalledTimes(1);
  });
});

describe('resolveNodeBinary duplicate references', () => {
  test('probes a repeated reference once, so the budget reaches a later attachment', () => {
    const repo = createRepo(['real.pdf']);
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 9; i += 1) data[`p${i}`] = 'decoy.png';
    data.media = 'real.pdf';

    const binary = resolveNodeBinary(repo, { _id: 'n', data });

    expect(binary?.binaryReference).toBe('real.pdf');
    const probed = repo.getBinary.mock.calls.map((call) => call[0].binaryReference);
    expect(probed.filter((ref) => ref === 'decoy.png')).toHaveLength(1);
  });

  test('deduplicates across an array as well as across properties', () => {
    const repo = createRepo(['real.pdf']);

    const binary = resolveNodeBinary(repo, {
      _id: 'n',
      gallery: Array.from({ length: 20 }, () => 'decoy.png'),
      media: 'real.pdf',
    });

    expect(binary?.binaryReference).toBe('real.pdf');
    expect(repo.getBinary).toHaveBeenCalledTimes(2);
  });
});
