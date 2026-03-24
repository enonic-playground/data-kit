import type { ByteSource } from '@enonic-types/core';
import { managementApiRequest } from './management-api';

//
// * Types
//

export type DumpEntry = {
    name: string;
    timestamp: string;
    type: 'versioned' | 'archived' | 'export';
    xpVersion: string;
    modelVersion: string;
    size: number;
};

export type CreateDumpParams = {
    name: string;
    includeVersions?: boolean;
    maxAge?: number;
    maxVersions?: number;
};

export type LoadDumpParams = {
    name: string;
    upgrade?: boolean;
    archive?: boolean;
};

export type TaskIdResponse = {
    taskId: string;
};

//
// * Bean
//

const dumpManager = __.newBean<DumpManager>('com.enonic.app.datakit.DumpManager');

//
// * Operations
//

export function listDumps(): DumpEntry[] {
    const json = dumpManager.list();
    return JSON.parse(json) as DumpEntry[];
}

export function deleteDump(name: string): boolean {
    return dumpManager.delete(name);
}

export function downloadDump(name: string): ByteSource | null {
    return dumpManager.download(name);
}

export function uploadDump(name: string, data: ByteSource): boolean {
    return dumpManager.upload(name, data as object);
}

export function createDump(params: CreateDumpParams, authHeader?: string): TaskIdResponse {
    return managementApiRequest<TaskIdResponse>('system/dump', {
        method: 'POST',
        body: params,
        authHeader,
    });
}

export function loadDump(params: LoadDumpParams, authHeader?: string): TaskIdResponse {
    return managementApiRequest<TaskIdResponse>('system/load', {
        method: 'POST',
        body: params,
        authHeader,
    });
}

export function upgradeDump(name: string, authHeader?: string): TaskIdResponse {
    return managementApiRequest<TaskIdResponse>('system/upgrade', {
        method: 'POST',
        body: { name },
        authHeader,
    });
}
