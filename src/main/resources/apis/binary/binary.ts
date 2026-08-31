import { getMimeType, getSize } from '/lib/xp/io';
import { connect } from '/lib/xp/node';

import type { ByteSource, Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';
import { resolveNodeBinary, resolveNodeImage } from '../../lib/node-binary';

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const repoId = getParam(req, 'repoId');
  if (repoId == null) {
    return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
  }

  const branch = getParam(req, 'branch');
  if (branch == null) {
    return errorResponse(400, 'Branch is required', 'VALIDATION_ERROR');
  }

  const key = getParam(req, 'key');
  if (key == null) {
    return errorResponse(400, 'Node key is required', 'VALIDATION_ERROR');
  }

  const resolveMode = getParam(req, 'resolve');
  const isLookup = resolveMode === 'image' || resolveMode === 'binary';
  const binaryReference = getParam(req, 'binaryReference');
  if (binaryReference == null && !isLookup) {
    return errorResponse(400, 'Binary reference is required', 'VALIDATION_ERROR');
  }

  const reference = binaryReference ?? '';
  const isInfo = getParam(req, 'info') === 'true';
  const isInline = getParam(req, 'inline') === 'true';

  try {
    const repo = connect({ repoId, branch });
    const node = repo.get(key);

    if (node == null) {
      return errorResponse(404, `Node '${key}' not found`, 'NOT_FOUND');
    }

    if (isLookup) {
      const found =
        resolveMode === 'image' ? resolveNodeImage(repo, node) : resolveNodeBinary(repo, node);
      if (found == null) {
        const what = resolveMode === 'image' ? 'image binary' : 'binary';
        return errorResponse(404, `Node '${key}' has no ${what}`, 'NOT_FOUND');
      }
      const source = repo.getBinary({ key, binaryReference: found.binaryReference });
      return jsonResponse({ ...found, size: getSize(source) });
    }

    let binary: ByteSource;
    try {
      binary = repo.getBinary({ key, binaryReference: reference });
    } catch (_e) {
      return errorResponse(404, `Binary '${reference}' not found`, 'NOT_FOUND');
    }

    if (binary == null) {
      return errorResponse(404, `Binary '${reference}' not found`, 'NOT_FOUND');
    }

    const mimeType = getMimeType(reference);

    if (isInfo) {
      return jsonResponse({ mimeType, size: getSize(binary) });
    }

    return {
      status: 200,
      contentType: mimeType,
      body: binary,
      headers: {
        'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${reference}"`,
        'Cache-Control': 'max-age=3600',
      },
    };
  } catch (_e) {
    return errorResponse(500, 'Failed to get binary', 'INTERNAL_ERROR');
  }
}
