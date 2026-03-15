import { run } from '/lib/xp/context';
import { exportNodes, importNodes } from '/lib/xp/export';
import { executeFunction, progress } from '/lib/xp/task';

//
// * Types
//

export type ExportEntry = {
    name: string;
    timestamp: string;
    format: 'directory' | 'zip';
    nodeCount: number;
    size: number;
};

export type CreateExportParams = {
    repositoryId: string;
    branch: string;
    nodePath: string;
    exportName: string;
};

export type ImportExportParams = {
    exportName: string;
    repositoryId: string;
    branch: string;
    targetNodePath: string;
    includeNodeIds?: boolean;
    includePermissions?: boolean;
};

export type TaskIdResponse = {
    taskId: string;
};

//
// * Bean
//

const exportManager = __.newBean<ExportManager>('com.enonic.app.datakit.ExportManager');

//
// * Operations
//

export function listExports(): ExportEntry[] {
    const json = exportManager.list();
    return JSON.parse(json) as ExportEntry[];
}

export function deleteExport(name: string): boolean {
    return exportManager.delete(name);
}

export function createExport(params: CreateExportParams): TaskIdResponse {
    const taskId = executeFunction({
        description: `Export nodes from ${params.repositoryId}:${params.branch}:${params.nodePath}`,
        func: () => {
            let processed = 0;
            let total = 0;
            const result = run(
                { repository: params.repositoryId, branch: params.branch },
                () =>
                    exportNodes({
                        sourceNodePath: params.nodePath,
                        exportName: params.exportName,
                        nodeResolved: (value) => {
                            total = value;
                            progress({ total });
                        },
                        nodeExported: (delta) => {
                            processed += delta;
                            progress({ current: processed, total });
                        },
                    }),
            );
            exportManager.writeMetadata(params.exportName, result.exportedNodes.length);
            progress({ info: JSON.stringify(result) });
        },
    });
    return { taskId };
}

export function importExport(params: ImportExportParams): TaskIdResponse {
    const taskId = executeFunction({
        description: `Import nodes to ${params.repositoryId}:${params.branch}:${params.targetNodePath}`,
        func: () => {
            let processed = 0;
            let total = 0;
            const result = run(
                { repository: params.repositoryId, branch: params.branch },
                () =>
                    importNodes({
                        source: params.exportName,
                        targetNodePath: params.targetNodePath,
                        includeNodeIds: params.includeNodeIds,
                        includePermissions: params.includePermissions,
                        nodeResolved: (value) => {
                            total = value;
                            progress({ total });
                        },
                        nodeImported: (delta) => {
                            processed += delta;
                            progress({ current: processed, total });
                        },
                        nodeSkipped: (delta) => {
                            processed += delta;
                            progress({ current: processed, total });
                        },
                    }),
            );
            progress({ info: JSON.stringify(result) });
        },
    });
    return { taskId };
}
