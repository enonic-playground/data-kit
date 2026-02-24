import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from './client';

type SystemInfo = {
    xpVersion: string;
    appVersion: string;
    appName: string;
};

export function fetchSystemInfo(): Promise<SystemInfo> {
    return apiFetch<SystemInfo>('/system');
}

export function systemInfoQueryOptions() {
    return queryOptions({
        queryKey: ['system', 'info'],
        queryFn: fetchSystemInfo,
    });
}
