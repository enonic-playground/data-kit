import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Request } from '@enonic-types/core';

const mockLogManager = vi.hoisted(() => ({
  list: vi.fn(),
  info: vi.fn(),
  read: vi.fn(),
  locate: vi.fn(),
  search: vi.fn(),
  download: vi.fn(),
}));

vi.hoisted(() => {
  globalThis.__ = { newBean: vi.fn(() => mockLogManager) } as unknown as typeof __;
});

vi.mock('/lib/xp/auth', () => ({
  hasRole: vi.fn(() => true),
}));

import { hasRole } from '/lib/xp/auth';

import { get } from '../../main/resources/apis/logs/logs';

const mockedHasRole = vi.mocked(hasRole);

beforeEach(() => {
  vi.clearAllMocks();
  mockedHasRole.mockReturnValue(true);
});

function request(params: Record<string, string>): Request {
  return { params } as unknown as Request;
}

function parseBody(response: { body?: string | object }) {
  return JSON.parse(response.body as string);
}

describe('authorization', () => {
  test('returns 403 for non-admin', () => {
    mockedHasRole.mockReturnValue(false);

    const response = get(request({}));

    expect(response.status).toBe(403);
    expect(parseBody(response).code).toBe('FORBIDDEN');
    expect(mockLogManager.list).not.toHaveBeenCalled();
  });
});

describe('file name validation', () => {
  test.each(['../server.log', '.hidden.log', 'dir/a.log', 'a.txt', 'server.log.gz', '-lead.log'])(
    'returns 400 for %s',
    (file) => {
      const response = get(request({ file }));

      expect(response.status).toBe(400);
      expect(parseBody(response).code).toBe('VALIDATION_ERROR');
      expect(mockLogManager.read).not.toHaveBeenCalled();
    },
  );

  test('returns 400 when an action is given without a file', () => {
    const response = get(request({ action: 'info' }));

    expect(response.status).toBe(400);
    expect(parseBody(response).message).toBe('file is required');
  });

  test('returns 400 for an unknown action', () => {
    const response = get(request({ file: 'server.log', action: 'tail' }));

    expect(response.status).toBe(400);
    expect(parseBody(response).message).toBe("Unknown action 'tail'");
  });
});

describe('list', () => {
  test('returns the log files envelope', () => {
    const files = [
      { name: 'server.log', size: 120, modified: '2026-08-27T10:00:00Z', active: true },
      {
        name: 'server.2026-08-26.0.log',
        size: 90,
        modified: '2026-08-26T10:00:00Z',
        active: false,
      },
    ];
    mockLogManager.list.mockReturnValue(JSON.stringify(files));

    const response = get(request({}));

    expect(response.status).toBe(200);
    expect(parseBody(response).data).toEqual({ files });
  });

  test('returns 500 when the bean fails', () => {
    mockLogManager.list.mockImplementation(() => {
      throw new Error('boom');
    });

    const response = get(request({}));

    expect(response.status).toBe(500);
    expect(parseBody(response).code).toBe('INTERNAL_ERROR');
  });
});

describe('info', () => {
  test('returns the parsed info envelope', () => {
    const info = {
      name: 'server.log',
      size: 120,
      modified: '2026-08-27T10:00:00Z',
      lines: 42,
      levels: { unknown: 0, trace: 1, debug: 2, info: 30, warn: 5, error: 4 },
    };
    mockLogManager.info.mockReturnValue(JSON.stringify(info));

    const response = get(request({ file: 'server.log', action: 'info' }));

    expect(response.status).toBe(200);
    expect(parseBody(response).data).toEqual(info);
    expect(mockLogManager.info).toHaveBeenCalledWith('server.log', 0);
  });

  test('returns 404 when the bean returns null', () => {
    mockLogManager.info.mockReturnValue(null);

    const response = get(request({ file: 'server.log', action: 'info' }));

    expect(response.status).toBe(404);
    expect(parseBody(response).code).toBe('NOT_FOUND');
  });
});

describe('levels', () => {
  const lines = { from: 0, lines: ['a'], total: 1, size: 2 };

  beforeEach(() => {
    mockLogManager.read.mockReturnValue(JSON.stringify(lines));
    mockLogManager.info.mockReturnValue(JSON.stringify({ name: 'server.log' }));
  });

  test.each([
    ['WARN,ERROR', (1 << 4) | (1 << 5)],
    ['error', 1 << 5],
    ['TRACE,DEBUG,INFO,WARN,ERROR', 0b111110],
    ['INFO,INFO', 1 << 3],
  ])('parses %s into a bitmask', (levels, mask) => {
    get(request({ file: 'server.log', levels }));

    expect(mockLogManager.read).toHaveBeenLastCalledWith('server.log', 0, 200, mask);
  });

  test('treats an absent or empty parameter as no filter', () => {
    get(request({ file: 'server.log' }));
    expect(mockLogManager.read).toHaveBeenLastCalledWith('server.log', 0, 200, 0);

    get(request({ file: 'server.log', levels: '' }));
    expect(mockLogManager.read).toHaveBeenLastCalledWith('server.log', 0, 200, 0);
  });

  test('reaches the info handler too', () => {
    get(request({ file: 'server.log', action: 'info', levels: 'ERROR' }));

    expect(mockLogManager.info).toHaveBeenCalledWith('server.log', 1 << 5);
  });

  test.each(['FATAL', 'WARN,NOPE', 'warn ,error', ',', 'E'.repeat(65)])(
    'returns 400 for %s',
    (levels) => {
      const response = get(request({ file: 'server.log', levels }));

      expect(response.status).toBe(400);
      expect(parseBody(response).code).toBe('VALIDATION_ERROR');
      expect(mockLogManager.read).not.toHaveBeenCalled();
    },
  );
});

describe('locate', () => {
  test('passes the mask and the line through to the bean', () => {
    mockLogManager.locate.mockReturnValue('{"position":3,"visible":false}');

    const response = get(
      request({ file: 'server.log', action: 'locate', line: '120', levels: 'ERROR' }),
    );

    expect(response.status).toBe(200);
    expect(parseBody(response).data).toEqual({ position: 3, visible: false });
    expect(mockLogManager.locate).toHaveBeenCalledWith('server.log', 1 << 5, 120);
  });

  test('clamps a negative line', () => {
    mockLogManager.locate.mockReturnValue('{"position":0,"visible":true}');

    get(request({ file: 'server.log', action: 'locate', line: '-9' }));

    expect(mockLogManager.locate).toHaveBeenCalledWith('server.log', 0, 0);
  });

  test('returns 400 without a line', () => {
    const response = get(request({ file: 'server.log', action: 'locate' }));

    expect(response.status).toBe(400);
    expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    expect(mockLogManager.locate).not.toHaveBeenCalled();
  });

  test('returns 404 when the bean returns null', () => {
    mockLogManager.locate.mockReturnValue(null);

    const response = get(request({ file: 'server.log', action: 'locate', line: '1' }));

    expect(response.status).toBe(404);
    expect(parseBody(response).code).toBe('NOT_FOUND');
  });
});

describe('read', () => {
  const lines = { from: 0, lines: ['a', 'b'], total: 2, size: 4 };

  test('returns the parsed lines envelope with the default count', () => {
    mockLogManager.read.mockReturnValue(JSON.stringify(lines));

    const response = get(request({ file: 'server.log' }));

    expect(response.status).toBe(200);
    expect(parseBody(response).data).toEqual(lines);
    expect(mockLogManager.read).toHaveBeenCalledWith('server.log', 0, 200, 0);
  });

  test('clamps count and from before calling the bean', () => {
    mockLogManager.read.mockReturnValue(JSON.stringify(lines));

    get(request({ file: 'server.log', from: '10', count: '5000' }));
    expect(mockLogManager.read).toHaveBeenLastCalledWith('server.log', 10, 1000, 0);

    get(request({ file: 'server.log', from: '-4', count: '0' }));
    expect(mockLogManager.read).toHaveBeenLastCalledWith('server.log', 0, 1, 0);

    get(request({ file: 'server.log', from: 'abc', count: 'xyz' }));
    expect(mockLogManager.read).toHaveBeenLastCalledWith('server.log', 0, 200, 0);

    get(request({ file: 'server.log', from: '12.9', count: '7.5' }));
    expect(mockLogManager.read).toHaveBeenLastCalledWith('server.log', 12, 7, 0);
  });

  test('returns 404 when the bean returns null', () => {
    mockLogManager.read.mockReturnValue(null);

    const response = get(request({ file: 'server.log' }));

    expect(response.status).toBe(404);
    expect(parseBody(response).code).toBe('NOT_FOUND');
  });
});

describe('search', () => {
  test('returns the matched line number', () => {
    mockLogManager.search.mockReturnValue(17);

    const response = get(
      request({ file: 'server.log', action: 'search', query: 'ERROR', from: '5' }),
    );

    expect(response.status).toBe(200);
    expect(parseBody(response).data).toEqual({ line: 17 });
    expect(mockLogManager.search).toHaveBeenCalledWith(
      'server.log',
      'ERROR',
      5,
      true,
      false,
      false,
      0,
    );
  });

  test('passes direction, regex and caseSensitive flags', () => {
    mockLogManager.search.mockReturnValue(-1);

    const response = get(
      request({
        file: 'server.log',
        action: 'search',
        query: 'e\\d+',
        direction: 'backward',
        regex: 'true',
        caseSensitive: 'true',
      }),
    );

    expect(parseBody(response).data).toEqual({ line: null });
    expect(mockLogManager.search).toHaveBeenCalledWith(
      'server.log',
      'e\\d+',
      0,
      false,
      true,
      true,
      0,
    );
  });

  test('scopes the search to the active level filter', () => {
    mockLogManager.search.mockReturnValue(17);

    const response = get(
      request({ file: 'server.log', action: 'search', query: 'boom', levels: 'WARN,ERROR' }),
    );

    expect(response.status).toBe(200);
    expect(mockLogManager.search).toHaveBeenCalledWith(
      'server.log',
      'boom',
      0,
      true,
      false,
      false,
      (1 << 4) | (1 << 5),
    );
  });

  test('rejects an unknown level before searching', () => {
    const response = get(
      request({ file: 'server.log', action: 'search', query: 'boom', levels: 'FATAL' }),
    );

    expect(response.status).toBe(400);
    expect(mockLogManager.search).not.toHaveBeenCalled();
  });

  test('returns 404 when the bean reports a missing file', () => {
    mockLogManager.search.mockReturnValue(-2);

    const response = get(request({ file: 'server.log', action: 'search', query: 'x' }));

    expect(response.status).toBe(404);
  });

  test('returns 400 when the bean aborts a regex that ran too long', () => {
    mockLogManager.search.mockReturnValue(-3);

    const response = get(
      request({ file: 'server.log', action: 'search', query: '(a+)+b', regex: 'true' }),
    );

    expect(response.status).toBe(400);
    expect(parseBody(response).code).toBe('SEARCH_TIMEOUT');
  });

  test('returns 400 for a missing, empty or oversized query', () => {
    expect(get(request({ file: 'server.log', action: 'search' })).status).toBe(400);
    expect(get(request({ file: 'server.log', action: 'search', query: '' })).status).toBe(400);
    expect(
      get(request({ file: 'server.log', action: 'search', query: 'x'.repeat(501) })).status,
    ).toBe(400);
    expect(mockLogManager.search).not.toHaveBeenCalled();
  });

  test('returns 400 for an unknown direction', () => {
    const response = get(
      request({ file: 'server.log', action: 'search', query: 'x', direction: 'sideways' }),
    );

    expect(response.status).toBe(400);
    expect(mockLogManager.search).not.toHaveBeenCalled();
  });

  test('returns 400 when the bean rejects the regex', () => {
    mockLogManager.search.mockImplementation(() => {
      throw new Error('Invalid regular expression: Unclosed character class');
    });

    const response = get(
      request({ file: 'server.log', action: 'search', query: '[unclosed', regex: 'true' }),
    );

    expect(response.status).toBe(400);
    expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    expect(parseBody(response).message).toContain('Invalid regular expression');
  });

  test('returns 500 for any other bean failure', () => {
    mockLogManager.search.mockImplementation(() => {
      throw new Error('disk on fire');
    });

    const response = get(request({ file: 'server.log', action: 'search', query: 'x' }));

    expect(response.status).toBe(500);
    expect(parseBody(response).code).toBe('INTERNAL_ERROR');
  });
});

describe('download', () => {
  test('streams the file as a text attachment', () => {
    const stream = { byteSource: true };
    mockLogManager.download.mockReturnValue(stream);

    const response = get(request({ file: 'server.log', action: 'download' }));

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('text/plain; charset=utf-8');
    expect(response.headers?.['Content-Disposition']).toBe('attachment; filename="server.log"');
    expect(response.body).toBe(stream);
  });

  test('returns 404 when the file is missing', () => {
    mockLogManager.download.mockReturnValue(null);

    const response = get(request({ file: 'server.log', action: 'download' }));

    expect(response.status).toBe(404);
  });
});
