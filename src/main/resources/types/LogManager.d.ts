declare interface LogManager {
  list: () => string;
  info: (name: string) => string | null;
  read: (name: string, from: number, count: number) => string | null;
  /**
   * Matching line number, `-1` when there is no match, `-2` when the file is invalid or missing,
   * `-3` when a regex ran past its time budget.
   */
  search: (
    name: string,
    query: string,
    from: number,
    forward: boolean,
    regex: boolean,
    caseSensitive: boolean,
  ) => number;
  download: (name: string) => import('@enonic-types/core').ByteSource | null;
}

interface XpBeans {
  'com.enonic.app.datakit.LogManager': LogManager;
}
