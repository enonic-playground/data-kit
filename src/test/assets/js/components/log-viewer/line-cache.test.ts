import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FetchChunkParams,
  FetchChunkResult,
  LineCache,
} from '../../../../../main/resources/assets/js/components/log-viewer/line-cache';

import { createLineCache } from '../../../../../main/resources/assets/js/components/log-viewer/line-cache';

const CHUNK = 4;

type Pending = {
  params: FetchChunkParams;
  resolve: (result: FetchChunkResult) => void;
  reject: (error: unknown) => void;
};

type Harness = {
  cache: LineCache;
  pending: Pending[];
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildLines(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `line ${from + i}`);
}

function createHarness(maxChunks = 64, retryDelayMs?: number): Harness {
  const pending: Pending[] = [];
  const cache = createLineCache({
    chunkSize: CHUNK,
    maxChunks,
    retryDelayMs,
    fetchChunk: (params) =>
      new Promise<FetchChunkResult>((resolve, reject) => {
        pending.push({ params, resolve, reject });
      }),
  });
  return { cache, pending };
}

/** Resolve the oldest outstanding request with the lines it asked for. */
function settle(harness: Harness): void {
  const next = harness.pending.shift();
  if (next == null) throw new Error('no pending request');
  const { from, count } = next.params;
  next.resolve({ from, lines: buildLines(from, count) });
}

/** Resolve the oldest outstanding request with physical line numbers, as a filtered read does. */
function settleFiltered(harness: Harness, numbers: number[]): void {
  const next = harness.pending.shift();
  if (next == null) throw new Error('no pending request');
  const { from } = next.params;
  next.resolve({
    from,
    lines: numbers.map((line) => `line ${line}`),
    numbers,
  });
}

/** Resolve the oldest outstanding request with fewer lines than it asked for. */
function settleShort(harness: Harness, count: number): void {
  const next = harness.pending.shift();
  if (next == null) throw new Error('no pending request');
  const { from } = next.params;
  next.resolve({ from, lines: buildLines(from, count) });
}

describe('createLineCache', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('should fetch the chunks covering a range and expose their lines', async () => {
    const { cache, pending } = harness;
    cache.setTotal(20, 200);

    expect(cache.getLine(0)).toBeUndefined();

    cache.ensureRange(0, 5);
    expect(pending.map((p) => p.params.from)).toEqual([0, 4]);
    expect(pending[0].params.count).toBe(CHUNK);

    settle(harness);
    settle(harness);
    await flush();

    expect(cache.getLine(0)).toBe('line 0');
    expect(cache.getLine(5)).toBe('line 5');
    expect(cache.getLine(8)).toBeUndefined();
  });

  it('should complete a chunk across requests when a page comes back short', async () => {
    const { cache, pending } = harness;
    cache.setTotal(CHUNK, 400);
    cache.ensureRange(0, CHUNK - 1);

    // ? The server caps a response by bytes, so long lines arrive piecemeal.
    settleShort(harness, 2);
    await flush();

    expect(cache.getLine(0)).toBe('line 0');
    expect(cache.getLine(2)).toBeUndefined();
    expect(pending.map((p) => [p.params.from, p.params.count])).toEqual([[2, 2]]);

    settle(harness);
    await flush();

    expect(cache.getLine(2)).toBe('line 2');
    expect(cache.getLine(3)).toBe('line 3');
    expect(pending).toHaveLength(0);
  });

  it('should back off instead of spinning when a page comes back empty', async () => {
    const retryDelayMs = 50;
    harness = createHarness(64, retryDelayMs);
    const { cache, pending } = harness;
    cache.setTotal(CHUNK, 400);
    cache.ensureRange(0, CHUNK - 1);

    // ? One line over the whole cap: an identical retry returns nothing again.
    settleShort(harness, 0);
    await flush();

    expect(cache.getCachedChunks()).toEqual([]);
    expect(cache.getLine(0)).toBeUndefined();
    expect(pending).toHaveLength(0);

    cache.ensureRange(0, CHUNK - 1);
    expect(pending).toHaveLength(0);

    await sleep(retryDelayMs * 3);
    cache.ensureRange(0, CHUNK - 1);

    expect(pending.map((p) => p.params.from)).toEqual([0]);

    cache.destroy();
  });

  it('should keep a chunk stale when its refetch comes back empty', async () => {
    const retryDelayMs = 50;
    harness = createHarness(64, retryDelayMs);
    const { cache, pending } = harness;
    cache.setTotal(CHUNK, 400);
    cache.ensureRange(0, CHUNK - 1);
    settle(harness);
    await flush();

    // ? Growth marks the tail stale, and its refetch then comes back empty.
    cache.setTotal(CHUNK, 500);
    cache.ensureRange(0, CHUNK - 1);
    settleShort(harness, 0);
    await flush();

    expect(cache.getLine(0)).toBe('line 0');

    await sleep(retryDelayMs * 3);
    cache.ensureRange(0, CHUNK - 1);

    // ? Still refetchable: an empty page must not leave the outdated copy standing as whole.
    expect(pending.map((p) => p.params.from)).toEqual([0]);

    cache.destroy();
  });

  it('should expose the physical line number of a filtered line', async () => {
    const { cache } = harness;
    cache.setTotal(4, 4000);
    cache.ensureRange(0, 3);
    settleFiltered(harness, [7, 8, 40, 41]);
    await flush();

    expect(cache.getLine(2)).toBe('line 40');
    expect(cache.getLineNumber(0)).toBe(7);
    expect(cache.getLineNumber(2)).toBe(40);
    expect(cache.getLineNumber(9)).toBeUndefined();
  });

  it('should report no line number when the response carries none', async () => {
    const { cache } = harness;
    cache.setTotal(4, 4000);
    cache.ensureRange(0, 3);
    settle(harness);
    await flush();

    expect(cache.getLine(1)).toBe('line 1');
    expect(cache.getLineNumber(1)).toBeUndefined();
  });

  it('should keep line numbers in step when a filtered page comes back short', async () => {
    const { cache } = harness;
    cache.setTotal(4, 4000);
    cache.ensureRange(0, 3);
    settleFiltered(harness, [7, 8]);
    await flush();

    expect(harness.pending[0]?.params).toMatchObject({ from: 2, count: 2 });
    settleFiltered(harness, [40, 41]);
    await flush();

    expect(cache.getLineNumber(0)).toBe(7);
    expect(cache.getLineNumber(3)).toBe(41);
    expect(cache.getLine(3)).toBe('line 41');
  });

  it('should drop line numbers along with the lines on reset', async () => {
    const { cache } = harness;
    cache.setTotal(4, 4000);
    cache.ensureRange(0, 3);
    settleFiltered(harness, [7, 8, 40, 41]);
    await flush();

    // ? A filter change goes through the same path as a file switch: nothing survives it.
    cache.reset();
    cache.setTotal(2, 4000);

    expect(cache.getLine(0)).toBeUndefined();
    expect(cache.getLineNumber(0)).toBeUndefined();
  });

  it('should never request past the known total', () => {
    const { cache, pending } = harness;
    cache.setTotal(5, 50);

    cache.ensureRange(0, 99);

    expect(pending.map((p) => p.params.from)).toEqual([0, 4]);
    expect(cache.getLine(5)).toBeUndefined();
  });

  it('should do nothing before a total is known', () => {
    const { cache, pending } = harness;
    cache.ensureRange(0, 100);
    expect(pending).toHaveLength(0);
  });

  it('should dedupe in-flight requests for the same chunk', () => {
    const { cache, pending } = harness;
    cache.setTotal(20, 200);

    cache.ensureRange(0, 3);
    cache.ensureRange(1, 2);
    cache.ensureRange(0, 3);

    expect(pending).toHaveLength(1);
  });

  it('should notify subscribers and bump the version when a chunk lands', async () => {
    const { cache } = harness;
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);

    cache.setTotal(8, 80);
    const afterTotal = cache.getVersion();

    cache.ensureRange(0, 3);
    settle(harness);
    await flush();

    expect(listener).toHaveBeenCalled();
    expect(cache.getVersion()).toBeGreaterThan(afterTotal);

    unsubscribe();
    const before = listener.mock.calls.length;
    cache.ensureRange(4, 7);
    settle(harness);
    await flush();

    expect(listener.mock.calls).toHaveLength(before);
  });

  it('should abort and ignore outstanding results after reset', async () => {
    const { cache, pending } = harness;
    cache.setTotal(8, 80);
    cache.ensureRange(0, 3);

    const inflight = pending[0];
    expect(inflight.params.signal.aborted).toBe(false);

    cache.reset();
    expect(inflight.params.signal.aborted).toBe(true);

    inflight.resolve({ from: 0, lines: buildLines(0, CHUNK) });
    await flush();

    cache.setTotal(8, 80);
    expect(cache.getLine(0)).toBeUndefined();
    expect(cache.getCachedChunks()).toEqual([]);
  });

  it('should drop cached content on reset', async () => {
    const { cache } = harness;
    cache.setTotal(8, 80);
    cache.ensureRange(0, 3);
    settle(harness);
    await flush();
    expect(cache.getLine(0)).toBe('line 0');

    cache.reset();

    expect(cache.getTotal()).toBe(0);
    expect(cache.getLine(0)).toBeUndefined();
  });

  it('should refetch only the tail chunk when the file grows', async () => {
    const { cache, pending } = harness;
    // ? 6 lines: chunk 0 is full, chunk 1 holds a partial 2 lines.
    cache.setTotal(6, 60);
    cache.ensureRange(0, 5);
    settle(harness);
    settle(harness);
    await flush();

    expect(cache.getCachedChunks()).toEqual([0, 1]);

    cache.setTotal(10, 100);

    // ? The pre-growth tail keeps rendering until its refetch lands.
    expect(cache.getCachedChunks()).toEqual([0, 1]);
    expect(cache.getLine(4)).toBe('line 4');

    cache.ensureRange(0, 9);
    // ? Chunk 1 is re-requested despite being cached; chunk 0 is left alone.
    expect(pending.map((p) => p.params.from)).toEqual([4, 8]);
    expect(cache.getLine(0)).toBe('line 0');
    expect(cache.getLine(8)).toBeUndefined();
  });

  it('should keep an in-flight tail request alive across growth polls and refetch it once', async () => {
    const { cache, pending } = harness;
    // ? 6 lines: chunk 1 holds the partial trailing line the poll keeps growing.
    cache.setTotal(6, 60);
    cache.ensureRange(4, 5);

    const inflight = pending.shift();
    if (inflight == null) throw new Error('no pending request');
    expect(inflight.params.from).toBe(4);

    for (let poll = 1; poll <= 5; poll += 1) cache.setTotal(6, 60 + poll * 10);

    expect(inflight.params.signal.aborted).toBe(false);
    expect(pending).toHaveLength(0);

    inflight.resolve({ from: 4, lines: buildLines(4, CHUNK) });
    await flush();

    // ? The landed content renders while exactly one refetch picks up the growth.
    expect(cache.getLine(4)).toBe('line 4');
    expect(pending.map((p) => p.params.from)).toEqual([4]);

    settle(harness);
    await flush();

    expect(pending).toHaveLength(0);
  });

  it('should re-request a stale tail chunk after its refetch fails', async () => {
    const retryDelayMs = 50;
    harness = createHarness(64, retryDelayMs);
    const { cache, pending } = harness;
    // ? 6 lines: chunk 1 holds the partial trailing line the poll keeps growing.
    cache.setTotal(6, 60);

    // ? Stands in for the viewer: the only thing that re-requests is a notify.
    cache.subscribe(() => {
      cache.ensureRange(4, 7);
    });

    cache.ensureRange(4, 5);
    const inflight = pending.shift();
    if (inflight == null) throw new Error('no pending request');

    cache.setTotal(8, 80);
    inflight.resolve({ from: 4, lines: ['stale 4', 'stale 5'] });
    await flush();

    const refetch = pending.shift();
    if (refetch == null) throw new Error('no refetch request');
    refetch.reject(new Error('network'));
    await flush();

    // ? The pre-growth copy keeps rendering — only its trailing line can be
    // ? outdated, and the appended lines are placeholders either way.
    expect(cache.getLine(4)).toBe('stale 4');
    expect(cache.getLine(6)).toBeUndefined();
    expect(pending).toHaveLength(0);

    await sleep(retryDelayMs * 3);

    expect(pending.map((p) => p.params.from)).toEqual([4]);
    settle(harness);
    await flush();

    expect(cache.getLine(4)).toBe('line 4');
    expect(cache.getLine(6)).toBe('line 6');
    expect(cache.getLine(7)).toBe('line 7');

    cache.destroy();
  });

  it('should discard everything when the file shrinks', async () => {
    const { cache } = harness;
    cache.setTotal(8, 80);
    cache.ensureRange(0, 7);
    settle(harness);
    settle(harness);
    await flush();
    expect(cache.getCachedChunks()).toHaveLength(2);

    cache.setTotal(3, 30);

    expect(cache.getCachedChunks()).toEqual([]);
    expect(cache.getTotal()).toBe(3);
  });

  it('should evict the least recently used chunks beyond the cap', async () => {
    harness = createHarness(2);
    const { cache } = harness;
    cache.setTotal(100, 1000);

    for (const start of [0, 4, 8]) {
      cache.ensureRange(start, start + 3);
      settle(harness);
      await flush();
    }

    expect(cache.getCachedChunks()).toEqual([1, 2]);
    expect(cache.getLine(0)).toBeUndefined();
    expect(cache.getLine(8)).toBe('line 8');
  });

  it('should keep a chunk alive while it stays in the requested range', async () => {
    harness = createHarness(2);
    const { cache } = harness;
    cache.setTotal(100, 1000);

    cache.ensureRange(0, 3);
    settle(harness);
    await flush();

    cache.ensureRange(4, 7);
    settle(harness);
    await flush();

    // ? Touching chunk 0 again makes chunk 1 the eviction candidate.
    cache.ensureRange(0, 3);
    cache.ensureRange(8, 11);
    settle(harness);
    await flush();

    expect(cache.getCachedChunks()).toEqual([0, 2]);
  });

  it('should not hammer a chunk that failed', async () => {
    const { cache, pending } = harness;
    cache.setTotal(8, 80);

    cache.ensureRange(0, 3);
    const failing = pending.shift();
    if (failing == null) throw new Error('no pending request');
    failing.reject(new Error('network'));
    await flush();

    expect(cache.getLine(0)).toBeUndefined();

    cache.ensureRange(0, 3);
    expect(pending).toHaveLength(0);
  });

  it('should wake up for a chunk that failed inside another chunk retry window', async () => {
    const retryDelayMs = 60;
    harness = createHarness(64, retryDelayMs);
    const { cache, pending } = harness;
    cache.setTotal(8, 80);

    // ? Stands in for the viewer: the only thing that re-requests is a notify.
    cache.subscribe(() => {
      cache.ensureRange(0, 7);
    });

    cache.ensureRange(0, 7);
    const first = pending.shift();
    const second = pending.shift();
    if (first == null || second == null) throw new Error('no pending request');
    expect([first.params.from, second.params.from]).toEqual([0, 4]);

    first.reject(new Error('network'));
    await sleep(retryDelayMs * 0.6);
    second.reject(new Error('network'));

    // ? Chunk 1 fails inside chunk 0's window, so its own wake-up must be armed.
    await sleep(retryDelayMs * 4);

    expect(pending.map((p) => p.params.from)).toEqual([0, 4]);

    settle(harness);
    settle(harness);
    await flush();

    expect(cache.getLine(0)).toBe('line 0');
    expect(cache.getLine(4)).toBe('line 4');

    cache.destroy();
  });

  it('should stop notifying after destroy', async () => {
    const { cache, pending } = harness;
    const listener = vi.fn();
    cache.subscribe(listener);

    cache.setTotal(8, 80);
    cache.ensureRange(0, 3);
    const inflight = pending[0];

    cache.destroy();
    expect(inflight.params.signal.aborted).toBe(true);

    listener.mockClear();
    inflight.resolve({ from: 0, lines: buildLines(0, CHUNK) });
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });
});
