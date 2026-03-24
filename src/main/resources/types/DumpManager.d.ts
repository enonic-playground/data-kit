declare interface DumpManager {
    list: () => string;
    delete: (name: string) => boolean;
    download: (name: string) => import('@enonic-types/core').ByteSource | null;
    upload: (name: string, data: object) => boolean;
}

interface XpBeans {
    'com.enonic.app.datakit.DumpManager': DumpManager;
}
