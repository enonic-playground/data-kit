import { getMultipartItem, getMultipartStream } from '/lib/xp/portal';

import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';
import {
  createExport,
  deleteExport,
  downloadExport,
  importExport,
  listExports,
  uploadExport,
} from '../../lib/exports';

const VALID_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,98}[A-Za-z0-9]$/;

function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const action = getParam(req, 'action');

  if (action === 'download') {
    const name = getParam(req, 'name');
    if (name == null) {
      return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
    }
    try {
      const stream = downloadExport(name);
      if (stream == null) {
        return errorResponse(404, `Export '${name}' not found`, 'NOT_FOUND');
      }
      return {
        status: 200,
        contentType: 'application/zip',
        body: stream,
        headers: {
          'Content-Disposition': `attachment; filename="${safeFilename(name)}.zip"`,
        },
      };
    } catch (e) {
      return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
  }

  try {
    const entries = listExports();
    return jsonResponse(entries);
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}

export function post(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const action = getParam(req, 'action');

  if (action === 'upload') {
    try {
      const item = getMultipartItem('file');
      if (item == null) return errorResponse(400, 'file is required', 'VALIDATION_ERROR');
      const stream = getMultipartStream('file');
      if (stream == null) return errorResponse(400, 'file stream is empty', 'VALIDATION_ERROR');
      const name = item.fileName.endsWith('.zip') ? item.fileName.slice(0, -4) : item.fileName;
      if (!VALID_NAME_PATTERN.test(name)) {
        return errorResponse(400, 'filename contains invalid characters', 'VALIDATION_ERROR');
      }
      const success = uploadExport(name, stream);
      if (!success) return errorResponse(409, `Export '${name}' already exists`, 'CONFLICT');
      return jsonResponse({ success: true, name });
    } catch (e) {
      return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
  }

  const body = req.body != null ? JSON.parse(req.body as string) : {};

  try {
    if (action === 'import') {
      const exportName = body.exportName as string | undefined;
      const repositoryId = body.repositoryId as string | undefined;
      const branch = body.branch as string | undefined;
      const targetNodePath = body.targetNodePath as string | undefined;
      if (exportName == null) {
        return errorResponse(400, 'exportName is required', 'VALIDATION_ERROR');
      }
      if (!VALID_NAME_PATTERN.test(exportName)) {
        return errorResponse(400, 'exportName contains invalid characters', 'VALIDATION_ERROR');
      }
      if (repositoryId == null) {
        return errorResponse(400, 'repositoryId is required', 'VALIDATION_ERROR');
      }
      if (branch == null) {
        return errorResponse(400, 'branch is required', 'VALIDATION_ERROR');
      }
      if (targetNodePath == null) {
        return errorResponse(400, 'targetNodePath is required', 'VALIDATION_ERROR');
      }
      const result = importExport({
        exportName,
        repositoryId,
        branch,
        targetNodePath,
        includeNodeIds: body.includeNodeIds as boolean | undefined,
        includePermissions: body.includePermissions as boolean | undefined,
      });
      return jsonResponse(result, 202);
    }

    const exportName = body.exportName as string | undefined;
    const repositoryId = body.repositoryId as string | undefined;
    const branch = body.branch as string | undefined;
    const nodePath = body.nodePath as string | undefined;
    if (exportName == null) {
      return errorResponse(400, 'exportName is required', 'VALIDATION_ERROR');
    }
    if (!VALID_NAME_PATTERN.test(exportName)) {
      return errorResponse(400, 'exportName contains invalid characters', 'VALIDATION_ERROR');
    }
    if (repositoryId == null) {
      return errorResponse(400, 'repositoryId is required', 'VALIDATION_ERROR');
    }
    if (branch == null) {
      return errorResponse(400, 'branch is required', 'VALIDATION_ERROR');
    }
    if (nodePath == null) {
      return errorResponse(400, 'nodePath is required', 'VALIDATION_ERROR');
    }
    const result = createExport({ exportName, repositoryId, branch, nodePath });
    return jsonResponse(result, 202);
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}

function delete_(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const name = getParam(req, 'name');
  if (name == null) {
    return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
  }

  try {
    const success = deleteExport(name);
    if (!success) {
      return errorResponse(404, `Export '${name}' not found`, 'NOT_FOUND');
    }
    return jsonResponse({ success: true });
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}

export { delete_ as delete };
