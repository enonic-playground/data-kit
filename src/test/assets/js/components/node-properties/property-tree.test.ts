import { describe, expect, it } from 'vitest';

import {
  buildPropertyTree,
  defaultExpandedPaths,
  detectPropertyType,
  flattenPropertyTree,
  LARGE_COLLECTION_SIZE,
  type PropertyNode,
} from '../../../../../main/resources/assets/js/components/node-properties/property-tree';

function pathsOf(nodes: readonly PropertyNode[]): string[] {
  return nodes.flatMap((node) => [node.path, ...pathsOf(node.children ?? [])]);
}

function find(nodes: readonly PropertyNode[], path: string): PropertyNode {
  const hit = findOrNull(nodes, path);
  if (hit == null) throw new Error(`no node at ${path}`);
  return hit;
}

function findOrNull(nodes: readonly PropertyNode[], path: string): PropertyNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const hit = node.children != null ? findOrNull(node.children, path) : null;
    if (hit != null) return hit;
  }
  return null;
}

describe('buildPropertyTree', () => {
  it('skips system keys at the root only', () => {
    const tree = buildPropertyTree({
      _id: 'abc',
      _name: 'node',
      displayName: 'Node',
      data: { _selected: 'keep' },
    });

    expect(tree.map((n) => n.path)).toEqual(['displayName', 'data']);
    expect(pathsOf(tree)).toContain('data._selected');
  });

  it('builds dotted paths through nested property sets', () => {
    const tree = buildPropertyTree({ data: { hero: { caption: 'Sunset' } } });

    expect(pathsOf(tree)).toEqual(['data', 'data.hero', 'data.hero.caption']);
    expect(find(tree, 'data.hero.caption').value).toBe('Sunset');
  });

  it('builds indexed paths for array elements and records the index', () => {
    const tree = buildPropertyTree({ data: { tags: ['a', 'b', 'c'] } });

    expect(pathsOf(tree)).toEqual([
      'data',
      'data.tags',
      'data.tags[0]',
      'data.tags[1]',
      'data.tags[2]',
    ]);
    expect(find(tree, 'data.tags[2]').index).toBe(2);
    expect(find(tree, 'data.tags[2]').value).toBe('c');
  });

  it('composes index and key for arrays of property sets', () => {
    const tree = buildPropertyTree({ items: [{ title: 'One' }, { title: 'Two' }] });

    expect(pathsOf(tree)).toEqual([
      'items',
      'items[0]',
      'items[0].title',
      'items[1]',
      'items[1].title',
    ]);
  });

  it('treats empty sets and arrays as childless containers', () => {
    const tree = buildPropertyTree({ set: {}, list: [] });

    expect(tree[0]).toMatchObject({ kind: 'set', children: [] });
    expect(tree[1]).toMatchObject({ kind: 'array', children: [] });
  });

  it('keeps null as a scalar leaf', () => {
    const tree = buildPropertyTree({ missing: null });

    expect(tree[0]).toMatchObject({ kind: 'scalar', value: null });
    expect(tree[0].children).toBeUndefined();
  });
});

describe('detectPropertyType', () => {
  it('reports structural types as certain', () => {
    expect(detectPropertyType({})).toEqual({ label: 'PropertySet', inferred: false });
    expect(detectPropertyType([])).toEqual({ label: 'Array', inferred: false });
    expect(detectPropertyType(true)).toEqual({ label: 'Boolean', inferred: false });
    expect(detectPropertyType('plain text')).toEqual({ label: 'String', inferred: false });
    expect(detectPropertyType(null)).toEqual({ label: 'null', inferred: false });
  });

  it('marks a UUID-shaped string as an inferred Reference, not an asserted one', () => {
    expect(detectPropertyType('7b3f1c22-1234-4a56-8b90-abcdefabcdef')).toEqual({
      label: 'Reference',
      inferred: true,
    });
  });

  it('marks the node binary reference as an inferred BinaryReference', () => {
    expect(detectPropertyType('logo.png', 'logo.png')).toEqual({
      label: 'BinaryReference',
      inferred: true,
    });
    expect(detectPropertyType('logo.png', 'other.png')).toEqual({
      label: 'String',
      inferred: false,
    });
  });

  it('resolves the node binary reference ahead of the UUID pattern', () => {
    const uuidLikeRef = '7b3f1c22-1234-4a56-8b90-abcdefabcdef';

    expect(detectPropertyType(uuidLikeRef, uuidLikeRef)).toEqual({
      label: 'BinaryReference',
      inferred: true,
    });
  });

  it('separates Double from Long by what JS can prove', () => {
    expect(detectPropertyType(1.5)).toEqual({ label: 'Double', inferred: false });
    expect(detectPropertyType(2)).toEqual({ label: 'Long', inferred: true });
  });

  it('infers the date and geo types XP flattens into strings', () => {
    expect(detectPropertyType('2026-08-30T10:15:00Z')).toEqual({
      label: 'DateTime',
      inferred: true,
    });
    expect(detectPropertyType('2026-08-30')).toEqual({ label: 'LocalDate', inferred: true });
    expect(detectPropertyType('10:15:00')).toEqual({ label: 'LocalTime', inferred: true });
    expect(detectPropertyType('59.91,10.75')).toEqual({ label: 'GeoPoint', inferred: true });
  });
});

describe('defaultExpandedPaths', () => {
  it('expands ordinary containers', () => {
    const tree = buildPropertyTree({ data: { hero: { caption: 'Sunset' } } });

    expect(defaultExpandedPaths(tree)).toEqual(new Set(['data', 'data.hero']));
  });

  it('leaves a collection above the threshold collapsed', () => {
    const big = Array.from({ length: LARGE_COLLECTION_SIZE + 1 }, (_, i) => `tag-${i}`);
    const tree = buildPropertyTree({ data: { tags: big } });

    const expanded = defaultExpandedPaths(tree);
    expect(expanded.has('data')).toBe(true);
    expect(expanded.has('data.tags')).toBe(false);
  });

  it('keeps a collection exactly at the threshold expanded', () => {
    const atLimit = Array.from({ length: LARGE_COLLECTION_SIZE }, (_, i) => `tag-${i}`);
    const tree = buildPropertyTree({ tags: atLimit });

    expect(defaultExpandedPaths(tree).has('tags')).toBe(true);
  });
});

describe('flattenPropertyTree', () => {
  const tree = buildPropertyTree({ data: { hero: { caption: 'Sunset' } }, displayName: 'Node' });

  it('emits only the roots when nothing is expanded', () => {
    expect(flattenPropertyTree(tree, new Set())).toEqual([
      { node: find(tree, 'data'), depth: 0 },
      { node: find(tree, 'displayName'), depth: 0 },
    ]);
  });

  it('walks into an expanded container and increments depth', () => {
    const rows = flattenPropertyTree(tree, new Set(['data', 'data.hero']));

    expect(rows.map((r) => [r.node.path, r.depth])).toEqual([
      ['data', 0],
      ['data.hero', 1],
      ['data.hero.caption', 2],
      ['displayName', 0],
    ]);
  });

  it('does not descend past a collapsed ancestor', () => {
    const rows = flattenPropertyTree(tree, new Set(['data.hero']));

    expect(rows.map((r) => r.node.path)).toEqual(['data', 'displayName']);
  });
});
