import { getMimeType } from '/lib/xp/io';

import type { ByteSource } from '@enonic-types/core';
import type { Node } from '@enonic-types/lib-node';

export type NodeBinary = {
  binaryReference: string;
  mimeType: string;
};

// ? XP serializes a BinaryReference as a bare string, indistinguishable from any other
// ? string property, so a candidate is only confirmed once getBinary() accepts it.
const MAX_DEPTH = 3;
// Repository lookups are the expensive part, so decoys are what the budget bounds.
const MAX_PROBES = 8;
// ! Arrays recurse at their property's depth, so MAX_DEPTH alone does not bound the
// ! walk — a self-referencing array would recurse forever without this budget.
const MAX_VISITS = 4096;

// Only what a filename cannot contain: path separators, newlines, a leading space.
// Spaces, `@` and digit-led extensions all name real uploads.
const FILENAME = /^[^\s/\\\r\n\t][^/\\\r\n\t]{0,254}\.[a-z0-9]{1,16}$/i;

// The one filter that may reject on shape, because a name that is not an image
// extension cannot become an image — and the grid runs this once per row.
const IMAGE_NAME = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;

// ! XP's MediaTypes is a fixed ~38-entry map and does not lowercase before looking up,
// ! so `.docx`, `.zip` and a camera's `IMG_1.JPG` all land here. It says nothing about
// ! whether a string names a binary — only the repository knows that.
const UNKNOWN_MIME = 'application/octet-stream';

// Probe order, best first: a plain typeable name outranks a sentence ending in one, an
// address, and an untypeable extension. Ranking rather than rejecting is what keeps
// anything that might be a binary reachable.
const BUCKETS = 4;

function rank(mimeType: string, value: string): number {
  const ornamented = value.indexOf(' ') >= 0 || value.indexOf('@') >= 0;
  return (mimeType === UNKNOWN_MIME ? 2 : 0) + (ornamented ? 1 : 0);
}

type BinaryReader = {
  getBinary: (params: { key: string; binaryReference: string }) => ByteSource;
};

type Candidate = {
  binaryReference: string;
  mimeType: string;
};

function mimeTypeOf(value: string): string {
  return getMimeType(value.toLowerCase());
}

function confirm(repo: BinaryReader, key: string, binaryReference: string): boolean {
  try {
    return repo.getBinary({ key, binaryReference }) != null;
  } catch (_e) {
    // ? A string can look like a filename without naming a binary; try the next.
    return false;
  }
}

//
// * Image resolution
//

type ImageWalk = {
  key: string;
  repo: BinaryReader;
  probes: number;
  visits: number;
};

function searchImage(value: unknown, depth: number, walk: ImageWalk): NodeBinary | undefined {
  if (depth > MAX_DEPTH || walk.visits >= MAX_VISITS) return undefined;
  walk.visits += 1;

  if (typeof value === 'string') {
    // The regex is free; getMimeType crosses into Java, so it only runs on a likely name.
    if (!IMAGE_NAME.test(value)) return undefined;
    const mimeType = mimeTypeOf(value);
    if (!mimeType.startsWith('image/')) return undefined;
    if (walk.probes >= MAX_PROBES) return undefined;
    walk.probes += 1;
    if (!confirm(walk.repo, walk.key, value)) return undefined;
    return { binaryReference: value, mimeType };
  }

  // A multi-valued property holds its values at the property's own depth.
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchImage(item, depth, walk);
      if (found != null) return found;
    }
    return undefined;
  }

  if (typeof value === 'object' && value != null) {
    for (const key of Object.keys(value)) {
      if (key.startsWith('_')) continue;
      const found = searchImage((value as Record<string, unknown>)[key], depth + 1, walk);
      if (found != null) return found;
    }
  }

  return undefined;
}

//
// * Binary resolution
//

type Walk = {
  buckets: Candidate[][];
  seen: Record<string, true>;
  visits: number;
};

function collect(value: unknown, depth: number, walk: Walk): void {
  if (depth > MAX_DEPTH || walk.visits >= MAX_VISITS) return;
  walk.visits += 1;

  if (typeof value === 'string') {
    if (!FILENAME.test(value)) return;
    // One reference can sit in several properties, and probing it twice buys nothing:
    // the repository's answer is the same, and the budget pays for it again.
    if (walk.seen[value] === true) return;
    walk.seen[value] = true;
    const mimeType = mimeTypeOf(value);
    walk.buckets[rank(mimeType, value)].push({ binaryReference: value, mimeType });
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collect(item, depth, walk);
    return;
  }

  if (typeof value === 'object' && value != null) {
    for (const key of Object.keys(value)) {
      if (key.startsWith('_')) continue;
      collect((value as Record<string, unknown>)[key], depth + 1, walk);
    }
  }
}

/**
 * A data property of the node naming a binary the repository can actually serve, or
 * `undefined` when it has none. Plain, typeable names are probed first.
 */
export function resolveNodeBinary(
  repo: BinaryReader,
  node: Node | Record<string, unknown>,
): NodeBinary | undefined {
  const walk: Walk = {
    buckets: Array.from({ length: BUCKETS }, () => [] as Candidate[]),
    seen: Object.create(null) as Record<string, true>,
    visits: 0,
  };

  try {
    collect(node, 0, walk);
  } catch (_e) {
    // ? A late failure must not discard candidates already in hand, so probing goes ahead.
  }

  try {
    const key = (node as Node)._id;
    let probes = 0;

    for (let i = 0; i < walk.buckets.length; i += 1) {
      // Each later non-empty bucket keeps one probe back, so a spaced name stays
      // reachable behind a run of plain ones that do not resolve.
      let reserved = 0;
      for (let j = i + 1; j < walk.buckets.length; j += 1) {
        if (walk.buckets[j].length > 0) reserved += 1;
      }

      for (const candidate of walk.buckets[i]) {
        if (probes >= MAX_PROBES - reserved) break;
        probes += 1;
        if (confirm(repo, key, candidate.binaryReference)) return candidate;
      }
    }
  } catch (_e) {
    return undefined;
  }

  return undefined;
}

/**
 * As `resolveNodeBinary`, but only an image — the grid renders what this returns
 * straight into an `<img>`, so a PDF would land there as a broken thumbnail. Stops at
 * the first hit: this runs once per row of the browse list.
 */
export function resolveNodeImage(
  repo: BinaryReader,
  node: Node | Record<string, unknown>,
): NodeBinary | undefined {
  try {
    return searchImage(node, 0, { key: (node as Node)._id, repo, probes: 0, visits: 0 });
  } catch (_e) {
    return undefined;
  }
}
