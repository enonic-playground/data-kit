declare interface LogManager {
  list: () => string;
  /**
   * File metadata with a per-level line count, plus `filtered` when `mask` selects a strict
   * subset of the levels.
   */
  info: (name: string, mask: number) => string | null;
  /**
   * A page of lines. `from` and the reported total count physical lines when `mask` admits every
   * level, and positions in the filtered view otherwise — in which case the response also carries
   * the physical line number of every line it returns.
   */
  read: (name: string, from: number, count: number, mask: number) => string | null;
  /**
   * `{"position":N,"visible":boolean}` — where a physical line sits in the filtered view, falling
   * back to the nearest visible position when the filter hides it.
   */
  locate: (name: string, mask: number, line: number) => string | null;
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
