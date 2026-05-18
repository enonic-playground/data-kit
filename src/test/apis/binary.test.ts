import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Request } from '@enonic-types/core';

vi.mock('/lib/xp/auth', () => ({
  hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/node', () => ({
  connect: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import { connect } from '/lib/xp/node';

import { get } from '../../main/resources/apis/binary/binary';

const mockedHasRole = vi.mocked(hasRole);
const mockedConnect = vi.mocked(connect);

function parseBody(response: { body?: string | object }) {
  return JSON.parse(response.body as string);
}

function createMockConnection(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockReturnValue(null),
    getBinary: vi.fn().mockReturnValue({ _bytes: true }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHasRole.mockReturnValue(true);
});

const NODE_WITH_ATTACHMENT = {
  _id: 'node-1',
  _name: 'my-content',
  _path: '/my-content',
  _attachments: {
    'image.png': { mimeType: 'image/png', size: 12345, label: 'source' },
    'doc.pdf': { mimeType: 'application/pdf', size: 98765 },
  },
};

describe('GET /binary (download)', () => {
  test('returns binary with correct contentType and headers', () => {
    const binaryData = { _bytes: true };
    const mockConn = createMockConnection({
      get: vi.fn().mockReturnValue(NODE_WITH_ATTACHMENT),
      getBinary: vi.fn().mockReturnValue(binaryData),
    });
    mockedConnect.mockReturnValue(mockConn as never);

    const response = get({
      params: { repoId: 'my-repo', branch: 'master', key: 'node-1', binaryReference: 'image.png' },
    } as unknown as Request);

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('image/png');
    expect(response.body).toBe(binaryData);
    expect(response.headers).toEqual({
      'Content-Disposition': 'attachment; filename="image.png"',
      'Cache-Control': 'max-age=3600',
    });
    expect(mockConn.getBinary).toHaveBeenCalledWith({
      key: 'node-1',
      binaryReference: 'image.png',
    });
  });

  test('returns 404 for missing node', () => {
    const mockConn = createMockConnection({
      get: vi.fn().mockReturnValue(null),
    });
    mockedConnect.mockReturnValue(mockConn as never);

    const response = get({
      params: {
        repoId: 'my-repo',
        branch: 'master',
        key: 'nonexistent',
        binaryReference: 'image.png',
      },
    } as unknown as Request);

    expect(response.status).toBe(404);
    expect(parseBody(response).code).toBe('NOT_FOUND');
  });

  test('returns 404 for missing binaryReference in _attachments', () => {
    const mockConn = createMockConnection({
      get: vi.fn().mockReturnValue(NODE_WITH_ATTACHMENT),
    });
    mockedConnect.mockReturnValue(mockConn as never);

    const response = get({
      params: {
        repoId: 'my-repo',
        branch: 'master',
        key: 'node-1',
        binaryReference: 'missing.txt',
      },
    } as unknown as Request);

    expect(response.status).toBe(404);
    expect(parseBody(response).code).toBe('NOT_FOUND');
  });

  test('returns 400 for missing required params', () => {
    const cases = [
      { params: { branch: 'master', key: 'node-1', binaryReference: 'img.png' } },
      { params: { repoId: 'my-repo', key: 'node-1', binaryReference: 'img.png' } },
      { params: { repoId: 'my-repo', branch: 'master', binaryReference: 'img.png' } },
      { params: { repoId: 'my-repo', branch: 'master', key: 'node-1' } },
    ];

    for (const req of cases) {
      const response = get(req as unknown as Request);
      expect(response.status).toBe(400);
      expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    }
  });

  test('returns 403 for non-admin', () => {
    mockedHasRole.mockReturnValue(false);

    const response = get({
      params: { repoId: 'my-repo', branch: 'master', key: 'node-1', binaryReference: 'image.png' },
    } as unknown as Request);

    expect(response.status).toBe(403);
    expect(parseBody(response).code).toBe('FORBIDDEN');
  });

  test('returns 500 when connection fails', () => {
    mockedConnect.mockImplementation(() => {
      throw new Error('Connection failed');
    });

    const response = get({
      params: { repoId: 'my-repo', branch: 'master', key: 'node-1', binaryReference: 'image.png' },
    } as unknown as Request);

    expect(response.status).toBe(500);
    expect(parseBody(response).code).toBe('INTERNAL_ERROR');
  });
});

describe('GET /binary?info=true', () => {
  test('returns JSON metadata envelope', () => {
    const mockConn = createMockConnection({
      get: vi.fn().mockReturnValue(NODE_WITH_ATTACHMENT),
    });
    mockedConnect.mockReturnValue(mockConn as never);

    const response = get({
      params: {
        repoId: 'my-repo',
        branch: 'master',
        key: 'node-1',
        binaryReference: 'image.png',
        info: 'true',
      },
    } as unknown as Request);
    const body = parseBody(response);

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(body.data).toEqual({
      mimeType: 'image/png',
      size: 12345,
      label: 'source',
    });
  });

  test('returns info without label when absent', () => {
    const mockConn = createMockConnection({
      get: vi.fn().mockReturnValue(NODE_WITH_ATTACHMENT),
    });
    mockedConnect.mockReturnValue(mockConn as never);

    const response = get({
      params: {
        repoId: 'my-repo',
        branch: 'master',
        key: 'node-1',
        binaryReference: 'doc.pdf',
        info: 'true',
      },
    } as unknown as Request);
    const body = parseBody(response);

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      mimeType: 'application/pdf',
      size: 98765,
      label: undefined,
    });
  });

  test('returns 404 for missing attachment in info mode', () => {
    const mockConn = createMockConnection({
      get: vi.fn().mockReturnValue(NODE_WITH_ATTACHMENT),
    });
    mockedConnect.mockReturnValue(mockConn as never);

    const response = get({
      params: {
        repoId: 'my-repo',
        branch: 'master',
        key: 'node-1',
        binaryReference: 'nope.txt',
        info: 'true',
      },
    } as unknown as Request);

    expect(response.status).toBe(404);
  });
});
