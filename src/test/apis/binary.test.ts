import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Request } from '@enonic-types/core';

vi.mock('/lib/xp/auth', () => ({
  hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/io', () => ({
  getMimeType: vi.fn(),
  getSize: vi.fn(),
}));

vi.mock('/lib/xp/node', () => ({
  connect: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import { getMimeType, getSize } from '/lib/xp/io';
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


const mockedGetMimeType = vi.mocked(getMimeType);
const mockedGetSize = vi.mocked(getSize);

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

function byExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHasRole.mockReturnValue(true);
  mockedGetMimeType.mockImplementation(byExtension);
  mockedGetSize.mockReturnValue(2048);
});

const NODE_WITH_BINARIES = {
  _id: 'node-1',
  _name: 'my-content',
  _path: '/my-content',
  media: 'image.png',
  manual: 'doc.pdf',
};

const AVAILABLE_BINARIES = ['image.png', 'doc.pdf'];

function createBinaryConnection(available: string[] = AVAILABLE_BINARIES) {
  return createMockConnection({
    get: vi.fn().mockReturnValue(NODE_WITH_BINARIES),
    getBinary: vi.fn(({ binaryReference }: { binaryReference: string }) => {
      if (!available.includes(binaryReference)) throw new Error('no such binary');
      return { _bytes: true };
    }),
  });
}

describe('GET /binary (download)', () => {
  test('returns binary with correct contentType and headers', () => {
    const binaryData = { _bytes: true };
    const mockConn = createMockConnection({
      get: vi.fn().mockReturnValue(NODE_WITH_BINARIES),
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

  test('serves inline disposition when inline=true', () => {
    const mockConn = createBinaryConnection();
    mockedConnect.mockReturnValue(mockConn as never);

    const response = get({
      params: {
        repoId: 'my-repo',
        branch: 'master',
        key: 'node-1',
        binaryReference: 'image.png',
        inline: 'true',
      },
    } as unknown as Request);

    expect(response.status).toBe(200);
    expect(response.headers).toEqual({
      'Content-Disposition': 'inline; filename="image.png"',
      'Cache-Control': 'max-age=3600',
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

  test('returns 404 when the repository has no such binary', () => {
    const mockConn = createBinaryConnection();
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
    const mockConn = createBinaryConnection();
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
      size: 2048,
    });
  });

  test('derives the mime type from the binary reference name', () => {
    const mockConn = createBinaryConnection();
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
      size: 2048,
    });
  });

  test('returns 404 for a missing binary in info mode', () => {
    const mockConn = createBinaryConnection();
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

describe('GET /binary?resolve=image', () => {
  test('resolves the node image without a binaryReference param', () => {
    mockedConnect.mockReturnValue(createBinaryConnection() as never);

    const response = get({
      params: { repoId: 'my-repo', branch: 'master', key: 'node-1', resolve: 'image' },
    } as unknown as Request);

    expect(response.status).toBe(200);
    expect(parseBody(response).data).toEqual({
      binaryReference: 'image.png',
      mimeType: 'image/png',
      size: 2048,
    });
  });

  test('returns 404 when the node has no image binary', () => {
    mockedConnect.mockReturnValue(
      createMockConnection({
        get: vi.fn().mockReturnValue({ _id: 'node-1', manual: 'doc.pdf' }),
      }) as never,
    );

    const response = get({
      params: { repoId: 'my-repo', branch: 'master', key: 'node-1', resolve: 'image' },
    } as unknown as Request);

    expect(response.status).toBe(404);
    expect(parseBody(response).code).toBe('NOT_FOUND');
  });
});
