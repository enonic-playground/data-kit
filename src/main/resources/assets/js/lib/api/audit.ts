import { queryOptions } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch } from './client';

export type AuditEntry = {
  _id: string;
  type: string;
  time: string;
  source: string;
  user: string;
  objects: string[];
  data: Record<string, unknown>;
};

export type AuditListParams = {
  from?: string;
  to?: string;
  type?: string;
  source?: string;
  user?: string;
  start?: number;
  count?: number;
};

export type AuditListResponse = {
  total: number;
  count: number;
  hits: AuditEntry[];
};

function toQueryParams(params: AuditListParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (params.from != null && params.from !== '') out.from = params.from;
  if (params.to != null && params.to !== '') out.to = params.to;
  if (params.type != null && params.type !== '') out.type = params.type;
  if (params.source != null && params.source !== '') out.source = params.source;
  if (params.user != null && params.user !== '') out.user = params.user;
  if (params.start != null) out.start = String(params.start);
  if (params.count != null) out.count = String(params.count);
  return out;
}

export function fetchAuditLog(params: AuditListParams): Promise<AuditListResponse> {
  const { apiUris } = getConfig();
  return apiFetch<AuditListResponse>(apiUris.audit, {
    params: toQueryParams(params),
  });
}

export function auditLogQueryOptions(params: AuditListParams) {
  return queryOptions({
    queryKey: ['audit', params],
    queryFn: () => fetchAuditLog(params),
    retry: false,
  });
}
