import { getMultipartItem, getMultipartStream } from '/lib/xp/portal';

import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';
import {
  createDump,
  deleteDump,
  downloadDump,
  listDumps,
  loadDump,
  upgradeDump,
  uploadDump,
} from '../../lib/dumps';

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
      const stream = downloadDump(name);
      if (stream == null) {
        return errorResponse(404, `Dump '${name}' not found`, 'NOT_FOUND');
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
    const dumps = listDumps();
    return jsonResponse(dumps);
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
      const success = uploadDump(name, stream);
      if (!success) return errorResponse(409, `Dump '${name}' already exists`, 'CONFLICT');
      return jsonResponse({ success: true, name });
    } catch (e) {
      return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
  }

  const authHeader = req.headers?.Authorization;
  const body = req.body != null ? JSON.parse(req.body as string) : {};

  try {
    if (action === 'load') {
      const name = body.name as string | undefined;
      if (name == null) {
        return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
      }
      const result = loadDump(
        {
          name,
          upgrade: body.upgrade as boolean | undefined,
          archive: body.archive as boolean | undefined,
        },
        authHeader,
      );
      return jsonResponse(result, 202);
    }

    if (action === 'upgrade') {
      const name = body.name as string | undefined;
      if (name == null) {
        return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
      }
      const result = upgradeDump(name, authHeader);
      return jsonResponse(result, 202);
    }

    const name = body.name as string | undefined;
    if (name == null) {
      return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
    }
    const result = createDump(
      {
        name,
        includeVersions: body.includeVersions as boolean | undefined,
        maxAge: body.maxAge as number | undefined,
        maxVersions: body.maxVersions as number | undefined,
      },
      authHeader,
    );
    return jsonResponse(result, 202);
  } catch (e) {
    return errorResponse(502, String(e), 'MANAGEMENT_API_ERROR');
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
    const success = deleteDump(name);
    if (!success) {
      return errorResponse(404, `Dump '${name}' not found`, 'NOT_FOUND');
    }
    return jsonResponse({ success: true });
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}

export { delete_ as delete };
