declare interface DumpManager {
    list: () => string;
    delete: (name: string) => boolean;
}

interface XpBeans {
    'com.enonic.app.datakit.DumpManager': DumpManager;
}
