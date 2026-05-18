import { getConfig } from '../config';

type BinaryDownloadParams = {
  repoId: string;
  branch: string;
  key: string;
  binaryReference: string;
};

export function buildBinaryDownloadUrl(params: BinaryDownloadParams): string {
  const { apiUris } = getConfig();
  const url = new URL(apiUris.binary, window.location.origin);
  url.searchParams.set('repoId', params.repoId);
  url.searchParams.set('branch', params.branch);
  url.searchParams.set('key', params.key);
  url.searchParams.set('binaryReference', params.binaryReference);
  return url.toString();
}
