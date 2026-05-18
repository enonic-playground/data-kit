import { connect } from '/lib/xp/node';

import type { ByteSource, Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

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

  const binaryReference = getParam(req, 'binaryReference');
  if (binaryReference == null) {
    return errorResponse(400, 'Binary reference is required', 'VALIDATION_ERROR');
  }

  const isInfo = getParam(req, 'info') === 'true';

  try {
    const repo = connect({ repoId, branch });
    const node = repo.get(key);

    if (node == null) {
      return errorResponse(404, `Node '${key}' not found`, 'NOT_FOUND');
    }

    const attachments = node._attachments as
      | Record<string, { mimeType: string; size: number; label?: string }>
      | undefined;
    const attachment = attachments?.[binaryReference];

    if (attachment == null) {
      return errorResponse(404, `Binary '${binaryReference}' not found`, 'NOT_FOUND');
    }

    if (isInfo) {
      return jsonResponse({
        mimeType: attachment.mimeType,
        size: attachment.size,
        label: attachment.label,
      });
    }

    const binary: ByteSource = repo.getBinary({ key, binaryReference });

    return {
      status: 200,
      contentType: attachment.mimeType || 'application/octet-stream',
      body: binary,
      headers: {
        'Content-Disposition': `attachment; filename="${binaryReference}"`,
        'Cache-Control': 'max-age=3600',
      },
    };
  } catch (_e) {
    return errorResponse(500, 'Failed to get binary', 'INTERNAL_ERROR');
  }
}
