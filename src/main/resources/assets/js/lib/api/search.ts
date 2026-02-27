import { getConfig } from '../config';
import { apiFetch } from './client';

export type SearchHit = {
    _id: string;
    _score: number;
    _repoId: string;
    _branch: string;
    _name?: string;
    _path?: string;
    _nodeType?: string;
};

export type SearchResponse = {
    hits: SearchHit[];
    total: number;
    executionTimeMs: number;
};

export type SearchParams = {
    query: string;
    repoId?: string;
    branch?: string;
    start?: number;
    count?: number;
    sort?: string;
};

export function executeSearch(params: SearchParams): Promise<SearchResponse> {
    const { apiUris } = getConfig();
    return apiFetch<SearchResponse>(apiUris.search, {
        method: 'POST',
        body: params,
    });
}
