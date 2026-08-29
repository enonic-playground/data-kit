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
