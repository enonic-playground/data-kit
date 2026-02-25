import { queryOptions } from '@tanstack/react-query';
import { getConfig } from '../config';
import { apiFetch } from './client';

type SystemInfo = {
    xpVersion: string;
    appVersion: string;
    appName: string;
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
