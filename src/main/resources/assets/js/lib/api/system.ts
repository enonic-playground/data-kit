import { queryOptions } from '@tanstack/react-query';
import { getConfig } from '../config';
import { apiFetch } from './client';

export type SystemInfo = {
    xpVersion: string;
    appName: string;
    appVersion: string;
    javaVersion: string;
    javaVendor: string;
    osName: string;
    osArch: string;
    osVersion: string;
    xpHome: string;
    diskTotal: number;
    diskUsable: number;
};

export function fetchSystemInfo(): Promise<SystemInfo> {
    const { apiUris } = getConfig();
    return apiFetch<SystemInfo>(apiUris.system);
}

export function systemInfoQueryOptions() {
    return queryOptions({
        queryKey: ['system', 'info'],
        queryFn: fetchSystemInfo,
    });
}
