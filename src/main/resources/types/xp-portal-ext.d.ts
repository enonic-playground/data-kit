// ? Augmentation for XP 8 portal API. Remove when @enonic-types/lib-portal publishes XP 8 types.
export {};

declare module '/lib/xp/portal' {
    export function apiUrl(params: {
        api: string;
        type?: 'server' | 'absolute' | 'websocket';
        params?: Record<string, string | string[]>;
        path?: string | string[];
        baseUrl?: string;
    }): string;
}
