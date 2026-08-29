import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => ({
    apiUris: { nodes: '/api/nodes', binary: '/api/binary' },
  })),
}));

vi.mock('../../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
}));

import {
  nodeImageQueryOptions,
  nodesQueryOptions,
} from '../../../../../main/resources/assets/js/lib/api/nodes';

const BASE = { repoId: 'my-repo', branch: 'master' };

describe('nodesQueryOptions', () => {
  it('should key list and grid requests separately', () => {
    const list = nodesQueryOptions({ ...BASE, parentPath: '/', images: false });
    const grid = nodesQueryOptions({ ...BASE, parentPath: '/', images: true });

    expect(list.queryKey).not.toEqual(grid.queryKey);
    expect(list.queryKey.at(-1)).toBe(false);
    expect(grid.queryKey.at(-1)).toBe(true);
  });

  it('should treat an omitted images flag as the list variant', () => {
    expect(nodesQueryOptions({ ...BASE, parentPath: '/' }).queryKey).toEqual(
      nodesQueryOptions({ ...BASE, parentPath: '/', images: false }).queryKey,
    );
  });
});

describe('nodeImageQueryOptions', () => {
  it('should key on the version so a new version cannot hit a cached entry', () => {
    const before = nodeImageQueryOptions({ ...BASE, key: 'node-1', versionKey: 'v1' });
    const after = nodeImageQueryOptions({ ...BASE, key: 'node-1', versionKey: 'v2' });

    expect(before.queryKey).not.toEqual(after.queryKey);
    expect(before.staleTime).toBe(Infinity);
  });
});
