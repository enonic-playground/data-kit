//
// * Chunked line cache
//
// Random access over a log file that is far too large to hold in memory. Lines
// are grouped into fixed-size chunks; the viewer asks for the visible range and
// the cache fetches whatever is missing, deduping concurrent requests and
// dropping results that a `reset()` (file switch) has made stale.
//
// Deliberately React-free so it can be unit-tested on its own.
//

export const CHUNK_SIZE = 256;
export const MAX_CACHED_CHUNKS = 64;

// ? A failed chunk is retried, but not on every scroll frame.
export const RETRY_DELAY_MS = 3000;

export type FetchChunkParams = {
  from: number;
  count: number;
  signal: AbortSignal;
};

export type FetchChunkResult = {
  from: number;
  lines: string[];
  /** Physical line number of each line; absent when no filter is active. */
  numbers?: number[];
};

/** Cached content of one chunk. `numbers` tracks `lines` element for element when present. */
type Chunk = {
  lines: string[];
  numbers?: number[];
};

export type LineCacheOptions = {
  fetchChunk: (params: FetchChunkParams) => Promise<FetchChunkResult>;
  chunkSize?: number;
  maxChunks?: number;
  retryDelayMs?: number;
};

export type LineCache = {
  /** Line text, or `undefined` while the containing chunk is missing or still partial. */
  getLine: (index: number) => string | undefined;
  /**
   * Physical line number of a cached line, or `undefined` when the line is not cached or no
   * filter is active — in which case the index is the physical line number.
   */
  getLineNumber: (index: number) => number | undefined;
  /** Request every chunk covering the inclusive line range. */
  ensureRange: (from: number, to: number) => void;
  /**
   * Publish the file's current line count and byte size. Growth invalidates the
   * mutable tail chunk; shrinking either one invalidates everything.
   */
  setTotal: (total: number, size: number) => void;
  getTotal: () => number;
  getSize: () => number;
  /** Drop everything and invalidate outstanding requests (file switch/reload). */
  reset: () => void;
  subscribe: (listener: () => void) => () => void;
  /** Bumped whenever cached content changes; for `useSyncExternalStore`. */
  getVersion: () => number;
  destroy: () => void;
  getCachedChunks: () => number[];
};

export function createLineCache({
  fetchChunk,
  chunkSize = CHUNK_SIZE,
  maxChunks = MAX_CACHED_CHUNKS,
  retryDelayMs = RETRY_DELAY_MS,
}: LineCacheOptions): LineCache {
  // ? Insertion order doubles as LRU order: `touch` re-inserts at the tail.
  const chunks = new Map<number, Chunk>();
  const pending = new Map<number, AbortController>();
  const failedAt = new Map<number, number>();
  // ? Chunks whose cached or in-flight content is known to be outdated. They
  // ? keep rendering while a refetch runs, and an in-flight request is left to
  // ? land rather than aborted, so a growing tail still converges.
  const staleChunks = new Set<number>();
  const listeners = new Set<() => void>();

  let generation = 0;
  let total = 0;
  let size = 0;
  let version = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  function notify(): void {
    version += 1;
    for (const listener of listeners) listener();
  }

  function clearRetry(): void {
    if (retryTimer === undefined) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  // ? Nothing else wakes the viewer while the viewport is still, so the cache
  // ? announces the moment a failed chunk becomes requestable again. Chunks
  // ? fail at different times, so the timer chains to the next one still inside
  // ? its backoff window instead of stopping after the first wake-up.
  function scheduleRetry(): void {
    if (retryTimer !== undefined) return;

    const now = Date.now();
    let soonest: number | undefined;
    for (const failed of failedAt.values()) {
      const due = failed + retryDelayMs;
      if (due <= now) continue;
      if (soonest === undefined || due < soonest) soonest = due;
    }
    if (soonest === undefined) return;

    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (failedAt.size > 0) notify();
      scheduleRetry();
    }, soonest - now);
  }

  function touch(chunk: number): void {
    const cached = chunks.get(chunk);
    if (cached === undefined) return;
    chunks.delete(chunk);
    chunks.set(chunk, cached);
  }

  function evict(): void {
    while (chunks.size > maxChunks) {
      const oldest = chunks.keys().next();
      if (oldest.done === true) return;
      chunks.delete(oldest.value);
      // ? Nothing left to be stale — unless a request is still in flight, in
      // ? which case the flag still has to force its refetch when it lands.
      if (!pending.has(oldest.value)) staleChunks.delete(oldest.value);
    }
  }

  function abortAll(): void {
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  }

  function lastChunk(): number | undefined {
    return total > 0 ? Math.floor((total - 1) / chunkSize) : undefined;
  }

  /** Lines a chunk holds once whole. The chunk covering the last line is shorter. */
  function chunkLength(chunk: number): number {
    return Math.min(chunkSize, total - chunk * chunkSize);
  }

  function isWhole(chunk: number): boolean {
    const cached = chunks.get(chunk);
    return cached !== undefined && cached.lines.length >= chunkLength(chunk);
  }

  // ! Only the trailing line of a pre-growth copy can be wrong, so keep serving it; the chunk
  // ! stays stale so the retry wake-up re-requests it instead of `request` skipping it as whole.
  function fail(chunk: number, stale: boolean): void {
    if (stale) staleChunks.add(chunk);
    failedAt.set(chunk, Date.now());
    scheduleRetry();
    notify();
  }

  function request(chunk: number): void {
    if (pending.has(chunk)) return;
    // ? A stale chunk is re-requested even though it is cached: its lines keep
    // ? rendering until the refetch replaces them.
    const stale = staleChunks.has(chunk);
    if (!stale && isWhole(chunk)) return;

    const failed = failedAt.get(chunk);
    if (failed !== undefined && Date.now() - failed < retryDelayMs) {
      scheduleRetry();
      return;
    }
    failedAt.delete(chunk);

    const start = chunk * chunkSize;
    if (start >= total) return;

    staleChunks.delete(chunk);

    // ! The server caps a response by bytes, so a chunk of long lines arrives over
    // ! several requests. A stale chunk restarts instead: its trailing line may
    // ! have grown, and resuming would keep the outdated copy of it.
    const prefix = stale ? undefined : chunks.get(chunk);
    const prefixLength = prefix?.lines.length ?? 0;
    const from = start + prefixLength;

    const controller = new AbortController();
    const requestGeneration = generation;
    pending.set(chunk, controller);

    fetchChunk({ from, count: chunkSize - prefixLength, signal: controller.signal }).then(
      (result) => {
        if (requestGeneration !== generation) return;
        if (pending.get(chunk) !== controller) return;
        pending.delete(chunk);

        // ! One line over the whole byte cap yields an empty page, and an identical
        // ! retry yields it again — back off rather than resume in a tight loop.
        if (result.lines.length === 0) {
          fail(chunk, stale);
          return;
        }

        chunks.set(chunk, {
          lines: [...(prefix?.lines ?? []), ...result.lines],
          numbers:
            result.numbers === undefined
              ? undefined
              : [...(prefix?.numbers ?? []), ...result.numbers],
        });
        evict();
        notify();
        // ? Grew again while this was in flight, or came back short of the chunk.
        if (staleChunks.has(chunk) || !isWhole(chunk)) request(chunk);
      },
      () => {
        if (requestGeneration !== generation) return;
        if (pending.get(chunk) !== controller) return;
        pending.delete(chunk);
        fail(chunk, stale);
      },
    );
  }

  return {
    getLine(index: number): string | undefined {
      if (index < 0 || index >= total) return undefined;
      const cached = chunks.get(Math.floor(index / chunkSize));
      return cached?.lines[index % chunkSize];
    },

    getLineNumber(index: number): number | undefined {
      if (index < 0 || index >= total) return undefined;
      const cached = chunks.get(Math.floor(index / chunkSize));
      return cached?.numbers?.[index % chunkSize];
    },

    ensureRange(from: number, to: number): void {
      if (total === 0) return;
      const first = Math.max(0, Math.floor(from / chunkSize));
      const last = Math.floor(Math.min(to, total - 1) / chunkSize);
      for (let chunk = first; chunk <= last; chunk += 1) {
        touch(chunk);
        request(chunk);
      }
    },

    setTotal(nextTotal: number, nextSize: number): void {
      if (nextTotal === total && nextSize === size) return;

      if (nextTotal < total || nextSize < size) {
        // ? The file shrank (rotation/truncate) — nothing cached can be trusted.
        generation += 1;
        abortAll();
        chunks.clear();
        failedAt.clear();
        staleChunks.clear();
        clearRetry();
      } else {
        // ? Only the last chunk is mutable: it may hold a partial trailing line
        // ? that has since been appended to, which leaves `total` untouched.
        // ? Its cached lines keep rendering while `request` refetches it —
        // ? evicting them would blank the tail on every growth poll.
        const tail = lastChunk();
        if (tail !== undefined) {
          failedAt.delete(tail);
          // ! Aborting an in-flight tail would restart it on every poll and it
          // ! would never land; let it finish and refetch once it has.
          if (chunks.has(tail) || pending.has(tail)) staleChunks.add(tail);
        }
      }

      total = nextTotal;
      size = nextSize;
      notify();
    },

    getTotal(): number {
      return total;
    },

    getSize(): number {
      return size;
    },

    reset(): void {
      generation += 1;
      abortAll();
      chunks.clear();
      failedAt.clear();
      staleChunks.clear();
      clearRetry();
      total = 0;
      size = 0;
      notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getVersion(): number {
      return version;
    },

    destroy(): void {
      generation += 1;
      abortAll();
      chunks.clear();
      failedAt.clear();
      staleChunks.clear();
      clearRetry();
      listeners.clear();
    },

    getCachedChunks(): number[] {
      return [...chunks.keys()];
    },
  };
}
