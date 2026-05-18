import type { ApiError, ApiResponse } from '../../types/api';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type ApiFetchOptions = {
  method?: HttpMethod;
  body?: unknown;
  params?: Record<string, string>;
};

export function buildUrl(apiUrl: string, params?: Record<string, string>): string {
  const url = new URL(apiUrl, window.location.origin);

  if (params != null) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

export async function apiFetch<T>(apiUrl: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, params } = options;
  const url = buildUrl(apiUrl, params);

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

export type UploadOptions = {
  file: File;
  params?: Record<string, string>;
  onProgress?: (percent: number) => void;
};

export async function apiUpload(apiUrl: string, options: UploadOptions): Promise<void> {
  const { file, params, onProgress } = options;
  const url = buildUrl(apiUrl, params);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress != null) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const error: ApiError = JSON.parse(xhr.responseText);
          reject(error);
        } catch {
          reject({ status: xhr.status, message: xhr.statusText });
        }
      }
    });

    xhr.addEventListener('error', () => {
      reject({ status: 0, message: 'Network error' });
    });

    xhr.addEventListener('timeout', () => {
      reject({ status: 0, message: 'Upload timed out' });
    });

    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.send(formData);
  });
}
