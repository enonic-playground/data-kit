declare interface ExportManager {
    list: () => string;
    delete: (name: string) => boolean;
    writeMetadata: (name: string, nodeCount: number) => void;
}

interface XpBeans {
    'com.enonic.app.datakit.ExportManager': ExportManager;
}
