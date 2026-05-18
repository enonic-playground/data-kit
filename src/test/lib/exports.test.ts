import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockExportManager = vi.hoisted(() => ({
  list: vi.fn(),
  delete: vi.fn(),
  writeMetadata: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
}));

vi.hoisted(() => {
  globalThis.__ = { newBean: vi.fn(() => mockExportManager) } as unknown as typeof __;
});

vi.mock('/lib/xp/context', () => ({
  run: vi.fn((_ctx: unknown, callback: () => unknown) => callback()),
}));

const mockExportNodes = vi.fn(() => ({
  exportedNodes: ['node-1', 'node-2'],
  exportedBinaries: [],
  exportErrors: [],
}));

const mockImportNodes = vi.fn(() => ({
  addedNodes: ['node-1'],
  updatedNodes: ['node-2'],
  importedBinaries: [],
  importErrors: [],
}));

vi.mock('/lib/xp/export', () => ({
  exportNodes: (...args: unknown[]) => mockExportNodes(...args),
  importNodes: (...args: unknown[]) => mockImportNodes(...args),
}));

vi.mock('/lib/xp/task', () => ({
  executeFunction: vi.fn((params: { func: () => void }) => {
    params.func();
    return 'task-id';
  }),
  progress: vi.fn(),
}));

import { executeFunction, progress } from '/lib/xp/task';

import {
  createExport,
  deleteExport,
  downloadExport,
  importExport,
  listExports,
  uploadExport,
} from '../../main/resources/lib/exports';

const mockedExecuteFunction = vi.mocked(executeFunction);
const mockedProgress = vi.mocked(progress);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listExports', () => {
  test('returns parsed export entries', () => {
    const exports = [
      {
        name: 'export-1',
        timestamp: '2026-01-01T00:00:00Z',
        format: 'directory',
        nodeCount: 5,
        size: 1024,
      },
    ];
    mockExportManager.list.mockReturnValue(JSON.stringify(exports));

    const result = listExports();
    expect(result).toEqual(exports);
    expect(mockExportManager.list).toHaveBeenCalled();
  });

  test('returns empty array when no exports', () => {
    mockExportManager.list.mockReturnValue('[]');
    expect(listExports()).toEqual([]);
  });
});

describe('deleteExport', () => {
  test('returns true on success', () => {
    mockExportManager.delete.mockReturnValue(true);
    expect(deleteExport('my-export')).toBe(true);
    expect(mockExportManager.delete).toHaveBeenCalledWith('my-export');
  });

  test('returns false when not found', () => {
    mockExportManager.delete.mockReturnValue(false);
    expect(deleteExport('nonexistent')).toBe(false);
  });
});

describe('createExport', () => {
  test('calls executeFunction and returns taskId', () => {
    mockedExecuteFunction.mockReturnValue('task-123');

    const result = createExport({
      repositoryId: 'com.enonic.cms.default',
      branch: 'draft',
      nodePath: '/content',
      exportName: 'my-export',
    });

    expect(result).toEqual({ taskId: 'task-123' });
    expect(mockedExecuteFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('com.enonic.cms.default'),
      }),
    );
  });

  test('reports cumulative progress and writes metadata', () => {
    mockedExecuteFunction.mockImplementation((params: { func: () => void }) => {
      params.func();
      return 'task-id';
    });
    mockExportNodes.mockImplementation((params: Record<string, unknown>) => {
      const nodeResolved = params.nodeResolved as (n: number) => void;
      const nodeExported = params.nodeExported as (n: number) => void;
      nodeResolved(10);
      nodeExported(3);
      nodeExported(5);
      return {
        exportedNodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        exportedBinaries: [],
        exportErrors: [],
      };
    });

    createExport({
      repositoryId: 'com.enonic.cms.default',
      branch: 'draft',
      nodePath: '/content',
      exportName: 'my-export',
    });

    const progressCalls = mockedProgress.mock.calls;
    expect(progressCalls[0][0]).toEqual({ total: 10 });
    expect(progressCalls[1][0]).toEqual({ current: 3, total: 10 });
    expect(progressCalls[2][0]).toEqual({ current: 8, total: 10 });
    expect(mockExportManager.writeMetadata).toHaveBeenCalledWith('my-export', 8);
  });
});

describe('importExport', () => {
  test('calls executeFunction and returns taskId', () => {
    mockedExecuteFunction.mockReturnValue('task-456');

    const result = importExport({
      exportName: 'my-export',
      repositoryId: 'com.enonic.cms.default',
      branch: 'draft',
      targetNodePath: '/content',
      includeNodeIds: true,
      includePermissions: true,
    });

    expect(result).toEqual({ taskId: 'task-456' });
    expect(mockedExecuteFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('com.enonic.cms.default'),
      }),
    );
  });

  test('reports cumulative progress including skipped nodes', () => {
    mockedExecuteFunction.mockImplementation((params: { func: () => void }) => {
      params.func();
      return 'task-id';
    });
    mockImportNodes.mockImplementation((params: Record<string, unknown>) => {
      const nodeResolved = params.nodeResolved as (n: number) => void;
      const nodeImported = params.nodeImported as (n: number) => void;
      const nodeSkipped = params.nodeSkipped as (n: number) => void;
      nodeResolved(20);
      nodeImported(5);
      nodeSkipped(3);
      nodeImported(7);
      return { addedNodes: [], updatedNodes: [], importedBinaries: [], importErrors: [] };
    });

    importExport({
      exportName: 'my-export',
      repositoryId: 'com.enonic.cms.default',
      branch: 'draft',
      targetNodePath: '/content',
    });

    const progressCalls = mockedProgress.mock.calls;
    expect(progressCalls[0][0]).toEqual({ total: 20 });
    expect(progressCalls[1][0]).toEqual({ current: 5, total: 20 });
    expect(progressCalls[2][0]).toEqual({ current: 8, total: 20 });
    expect(progressCalls[3][0]).toEqual({ current: 15, total: 20 });
  });
});

describe('downloadExport', () => {
  test('returns ByteSource from bean', () => {
    const fakeStream = { fake: 'stream' };
    mockExportManager.download.mockReturnValue(fakeStream);
    expect(downloadExport('my-export')).toBe(fakeStream);
    expect(mockExportManager.download).toHaveBeenCalledWith('my-export');
  });

  test('returns null when not found', () => {
    mockExportManager.download.mockReturnValue(null);
    expect(downloadExport('nonexistent')).toBeNull();
  });
});

describe('uploadExport', () => {
  test('returns true on success', () => {
    mockExportManager.upload.mockReturnValue(true);
    const fakeData = { fake: 'data' };
    expect(uploadExport('my-export', fakeData as never)).toBe(true);
    expect(mockExportManager.upload).toHaveBeenCalledWith('my-export', fakeData);
  });

  test('returns false on conflict', () => {
    mockExportManager.upload.mockReturnValue(false);
    expect(uploadExport('existing', {} as never)).toBe(false);
  });
});
