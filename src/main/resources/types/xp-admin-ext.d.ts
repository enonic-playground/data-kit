// ? Augmentation for XP 8 admin API. Remove when @enonic-types/lib-admin publishes XP 8 types.
export {};

declare module '/lib/xp/admin' {
    export function extensionUrl(params: {
        application: string;
        extension: string;
        params?: Record<string, string>;
    }): string;
}
