import { getConfig } from '../config';

type BinaryUrlParams = {
  repoId: string;
  branch: string;
  key: string;
  binaryReference: string;
};

type BinaryPreviewParams = BinaryUrlParams & {
  versionKey: string;
};

function buildBinaryUrl(params: BinaryUrlParams): URL {
  const { apiUris } = getConfig();
  const url = new URL(apiUris.binary, window.location.origin);
  url.searchParams.set('repoId', params.repoId);
  url.searchParams.set('branch', params.branch);
  url.searchParams.set('key', params.key);
  url.searchParams.set('binaryReference', params.binaryReference);
  return url;
}

export function buildBinaryDownloadUrl(params: BinaryUrlParams): string {
  return buildBinaryUrl(params).toString();
}

// ? `v` is never read by the endpoint — it is there so the browser cache entry
// ? expires exactly when the node's content does.
export function buildBinaryPreviewUrl(params: BinaryPreviewParams): string {
  const url = buildBinaryUrl(params);
  url.searchParams.set('inline', 'true');
  url.searchParams.set('v', params.versionKey);
  return url.toString();
}

export const BINARY_TEXT_LIMIT = 256 * 1024;

export type BinaryText = {
  text: string;
  truncated: boolean;
};

/**
 * The head of a binary decoded as UTF-8. Not `apiFetch` — that unwraps a JSON
 * envelope, and this endpoint streams the bytes themselves.
 */
export async function fetchBinaryText(
  params: BinaryPreviewParams,
  signal?: AbortSignal,
): Promise<BinaryText> {
  const response = await fetch(buildBinaryPreviewUrl(params), { signal });
  if (!response.ok) throw new Error(`Failed to read binary: ${response.status}`);

  const reader = response.body?.getReader();
  if (reader == null) {
    const buffer = await response.arrayBuffer();
    const truncated = buffer.byteLength > BINARY_TEXT_LIMIT;
    const head = truncated ? buffer.slice(0, BINARY_TEXT_LIMIT) : buffer;
    return {
      text: new TextDecoder().decode(head, { stream: truncated }),
      truncated,
    };
  }

  // A log file can be gigabytes; cancelling the reader at the cap stops the transfer
  // rather than buffering the whole binary only to slice the head off it.
  const decoder = new TextDecoder();
  let text = '';
  let read = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // A chunk that exactly fills the budget is not yet proof of more; the next read
      // settles it, either as `done` or as the overflow this branch catches.
      const remaining = BINARY_TEXT_LIMIT - read;
      if (value.byteLength > remaining) {
        // Still streaming, and never flushed: a cut landing mid-character drops the
        // partial sequence instead of emitting a replacement character.
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        truncated = true;
        break;
      }

      read += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    if (!truncated) text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return { text, truncated };
}
