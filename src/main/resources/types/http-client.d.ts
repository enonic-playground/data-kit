declare const __brand: unique symbol;

type Stream = object & { [__brand]: 'Stream' };

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

type HttpContentType =
    | 'application/json'
    | 'application/x-www-form-urlencoded'
    | 'multipart/form-data'
    | (string & {});

type ResponseHeaders = {
    'content-type'?: string;
    'retry-after'?: string;
} & Record<string, string>;

export type HttpRequestOptions = {
    url: string;
    method?: HttpMethod;
    queryParams?: Record<string, string | number>;
    params?: Record<string, string>;
    headers?: Record<string, string>;
    connectionTimeout?: number;
    readTimeout?: number;
    body?: string | Stream;
    contentType?: HttpContentType;
    followRedirects?: boolean;
    multipart?: {
        name: string;
        value: string | Stream;
        fileName?: string;
        contentType?: HttpContentType;
    }[];
    auth?: {
        user: string;
        password: string;
    };
    proxy?: {
        host: string;
        port: number;
        user?: string;
        password?: string;
    };
    certificates?: Stream;
    clientCertificate?: Stream;
};

export type HttpResponse = {
    status: number;
    message: string;
    headers: ResponseHeaders;
    cookies: Record<string, string>;
    contentType: string;
    body: string | null;
    bodyStream?: Stream;
};

export function request(params: HttpRequestOptions): HttpResponse;
