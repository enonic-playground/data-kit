import { getMimeType } from '/lib/xp/io';

import type { ByteSource } from '@enonic-types/core';
import type { Node } from '@enonic-types/lib-node';

export type NodeImage = {
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

const IMAGE_NAME = /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)$/i;

type BinaryReader = {
  getBinary: (params: { key: string; binaryReference: string }) => ByteSource;
};

type Walk = {
  key: string;
  repo: BinaryReader;
  probes: number;
  visits: number;
};

function probe(walk: Walk, binaryReference: string): NodeImage | undefined {
  if (walk.probes >= MAX_PROBES) return undefined;
  walk.probes += 1;

  try {
    if (walk.repo.getBinary({ key: walk.key, binaryReference }) == null) return undefined;
  } catch (_e) {
    // ? A string can look like a filename without naming a binary; the walk tries the next.
    return undefined;
  }

  return { binaryReference, mimeType: getMimeType(binaryReference) };
}

function search(value: unknown, depth: number, walk: Walk): NodeImage | undefined {
  if (depth > MAX_DEPTH || walk.visits >= MAX_VISITS) return undefined;
  walk.visits += 1;

  if (typeof value === 'string') {
    // The regex is free; getMimeType crosses into Java, so it only runs on a likely name.
    if (!IMAGE_NAME.test(value) || getMimeType(value).indexOf('image/') !== 0) return undefined;
    return probe(walk, value);
  }

  // A multi-valued property holds its values at the property's own depth.
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = search(item, depth, walk);
      if (found != null) return found;
    }
    return undefined;
  }

  if (typeof value === 'object' && value != null) {
    for (const key of Object.keys(value)) {
      if (key.indexOf('_') === 0) continue;
      const found = search((value as Record<string, unknown>)[key], depth + 1, walk);
      if (found != null) return found;
    }
  }

  return undefined;
}

/**
 * The node's first data property naming an image binary that the repository can
 * actually serve, or `undefined` when it has none.
 */
export function resolveNodeImage(
  repo: BinaryReader,
  node: Node | Record<string, unknown>,
): NodeImage | undefined {
  try {
    return search(node, 0, { key: (node as Node)._id, repo, probes: 0, visits: 0 });
  } catch (_e) {
    return undefined;
  }
}
