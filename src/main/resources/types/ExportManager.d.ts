declare interface ExportManager {
  list: () => string;
  delete: (name: string) => boolean;
  writeMetadata: (name: string, nodeCount: number) => void;
  download: (name: string) => import('@enonic-types/core').ByteSource | null;
  upload: (name: string, data: object) => boolean;
}

interface XpBeans {
  'com.enonic.app.datakit.ExportManager': ExportManager;
}
