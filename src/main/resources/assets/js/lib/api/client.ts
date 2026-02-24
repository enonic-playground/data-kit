import type { ApiError, ApiResponse } from '../../types/api';
import { getConfig } from '../config';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type ApiFetchOptions = {
    method?: HttpMethod;
    body?: unknown;
    params?: Record<string, string>;
};

function buildUrl(endpoint: string, params?: Record<string, string>): string {
    const { apiUri } = getConfig();
    const url = new URL(`${apiUri}${endpoint}`, window.location.origin);

    if (params != null) {
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
    }

    return url.toString();
}

export async function apiFetch<T>(endpoint: string, options: ApiFetchOptions = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = buildUrl(endpoint, params);

    const headers: Record<string, string> = {
        Accept: 'application/json',
    };

    if (body != null) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const error: ApiError = await response.json().catch(() => ({
            status: response.status,
            message: response.statusText,
        }));
        throw error;
    }

    const envelope: ApiResponse<T> = await response.json();
    return envelope.data;
}
