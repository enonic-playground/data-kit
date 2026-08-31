// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => ({
    apiUris: { nodes: '/api/nodes', binary: '/api/binary' },
  })),
}));

import {
  BINARY_TEXT_LIMIT,
  buildBinaryDownloadUrl,
  buildBinaryPreviewUrl,
  fetchBinaryText,
} from '../../../../../main/resources/assets/js/lib/api/binary';

const PARAMS = {
  repoId: 'my-repo',
  branch: 'master',
  key: 'node-1',
  binaryReference: 'notes.txt',
  versionKey: 'v1',
};

/** A response whose body streams `chunks` in order, so the cap is exercised mid-transfer. */
function streamingResponse(chunks: Uint8Array[]) {
  let index = 0;
  const cancel = vi.fn(() => Promise.resolve());
  const reader = {
    read: () => {
      if (index >= chunks.length) return Promise.resolve({ done: true, value: undefined });
      const value = chunks[index];
      index += 1;
      return Promise.resolve({ done: false, value });
    },
    cancel,
  };
  return {
    response: { ok: true, body: { getReader: () => reader } },
    cancel,
    chunksRead: () => index,
  };
}

function bytes(length: number, fill = 97): Uint8Array {
  return new Uint8Array(length).fill(fill);
}

function stubFetch(response: unknown) {
  const spy = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('buildBinaryPreviewUrl', () => {
  it('should mark the request inline and bust the cache on the version', () => {
    const url = new URL(buildBinaryPreviewUrl(PARAMS), 'http://localhost');

    expect(Object.fromEntries(url.searchParams)).toEqual({
      repoId: 'my-repo',
      branch: 'master',
      key: 'node-1',
      binaryReference: 'notes.txt',
      inline: 'true',
      v: 'v1',
    });
  });

  it('should not mark a download inline', () => {
    const url = new URL(buildBinaryDownloadUrl(PARAMS), 'http://localhost');

    expect(url.searchParams.get('inline')).toBeNull();
    expect(url.searchParams.get('v')).toBeNull();
  });
});

describe('fetchBinaryText', () => {
  it('should decode a body that fits under the cap without reporting truncation', async () => {
    const encoded = new TextEncoder().encode('hello world');
    const { response } = streamingResponse([encoded]);
    stubFetch(response);

    await expect(fetchBinaryText(PARAMS)).resolves.toEqual({
      text: 'hello world',
      truncated: false,
    });
  });

  it('should report truncation and keep exactly the cap when the body overruns it', async () => {
    const { response } = streamingResponse([bytes(BINARY_TEXT_LIMIT + 1)]);
    stubFetch(response);

    const result = await fetchBinaryText(PARAMS);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(BINARY_TEXT_LIMIT);
  });

  it('should not call a body that exactly fills the cap truncated', async () => {
    const { response } = streamingResponse([bytes(BINARY_TEXT_LIMIT)]);
    stubFetch(response);

    const result = await fetchBinaryText(PARAMS);

    expect(result.truncated).toBe(false);
    expect(result.text.length).toBe(BINARY_TEXT_LIMIT);
  });

  it('should report truncation when a later chunk proves there was more', async () => {
    const { response } = streamingResponse([bytes(BINARY_TEXT_LIMIT), bytes(1)]);
    stubFetch(response);

    const result = await fetchBinaryText(PARAMS);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(BINARY_TEXT_LIMIT);
  });

  it('should stop reading at the cap rather than draining the whole body', async () => {
    const oversized = Array.from({ length: 8 }, () => bytes(BINARY_TEXT_LIMIT));
    const { response, chunksRead } = streamingResponse(oversized);
    stubFetch(response);

    await fetchBinaryText(PARAMS);

    // The point of streaming: a gigabyte log costs one chunk, not the whole transfer.
    expect(chunksRead()).toBe(2);
  });

  it('should cancel the reader so the transfer is released', async () => {
    const { response, cancel } = streamingResponse([bytes(BINARY_TEXT_LIMIT + 1)]);
    stubFetch(response);

    await fetchBinaryText(PARAMS);

    expect(cancel).toHaveBeenCalled();
  });

  it('should drop a partial character at the cap rather than emitting a replacement', async () => {
    // 'é' straddles the cap: its first byte is the last byte read, its second is cut.
    const head = new TextEncoder().encode('a'.repeat(BINARY_TEXT_LIMIT - 1));
    const tail = new TextEncoder().encode('éz');
    const { response } = streamingResponse([head, tail]);
    stubFetch(response);

    const result = await fetchBinaryText(PARAMS);

    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain('�');
    expect(result.text).toBe('a'.repeat(BINARY_TEXT_LIMIT - 1));
  });

  it('should drop a partial character in the streamless fallback too', async () => {
    const buffer = new TextEncoder().encode(`${'a'.repeat(BINARY_TEXT_LIMIT - 1)}éz`).buffer;
    stubFetch({ ok: true, body: null, arrayBuffer: () => Promise.resolve(buffer) });

    const result = await fetchBinaryText(PARAMS);

    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain('�');
  });

  it('should join chunks that split a multi-byte character', async () => {
    const encoded = new TextEncoder().encode('héllo');
    const { response } = streamingResponse([encoded.slice(0, 2), encoded.slice(2)]);
    stubFetch(response);

    await expect(fetchBinaryText(PARAMS)).resolves.toEqual({ text: 'héllo', truncated: false });
  });

  it('should request the inline URL for the given binary', async () => {
    const { response } = streamingResponse([bytes(4)]);
    const spy = stubFetch(response);

    await fetchBinaryText(PARAMS);

    const url = new URL(spy.mock.calls[0][0] as string, 'http://localhost');
    expect(url.searchParams.get('inline')).toBe('true');
    expect(url.searchParams.get('binaryReference')).toBe('notes.txt');
  });

  it('should reject on a non-ok response rather than returning empty text', async () => {
    stubFetch({ ok: false, status: 404, body: null });

    await expect(fetchBinaryText(PARAMS)).rejects.toThrow('404');
  });

  it('should fall back to arrayBuffer when the response exposes no stream', async () => {
    const buffer = new TextEncoder().encode('no stream here').buffer;
    stubFetch({ ok: true, body: null, arrayBuffer: () => Promise.resolve(buffer) });

    await expect(fetchBinaryText(PARAMS)).resolves.toEqual({
      text: 'no stream here',
      truncated: false,
    });
  });

  it('should cap the streamless fallback too', async () => {
    const buffer = bytes(BINARY_TEXT_LIMIT + 10).buffer;
    stubFetch({ ok: true, body: null, arrayBuffer: () => Promise.resolve(buffer) });

    const result = await fetchBinaryText(PARAMS);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(BINARY_TEXT_LIMIT);
  });
});
