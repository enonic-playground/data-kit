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
   * The next match among the lines `mask` admits, with the whole-file count around it:
   * `{"status":"ok","line":L,"ordinal":O,"total":T,"levels":[..],"scanned":S,"lines":N,
   * "complete":B}`. `line` and `ordinal` are `null` when nothing matches, `ordinal` alone when
   * the count has not reached the hit. `null` when the file is invalid or missing; a `status` of
   * `aborted` when a regex ran past its time budget, or `stale` when the file was rewritten
   * mid-scan.
   */
  search: (
    name: string,
    query: string,
    from: number,
    forward: boolean,
    regex: boolean,
    caseSensitive: boolean,
    mask: number,
  ) => string | null;
  /**
   * One bounded slice of the whole-file match count, as
   * `{"status":"ok","total":T,"levels":[..],"scanned":S,"lines":N,"complete":B}`. Call again
   * while `complete` is false. Takes no mask: `levels` splits every match by level, so the
   * caller derives what its own filter shows and hides without the scan being invalidated.
   */
  matches: (
    name: string,
    query: string,
    regex: boolean,
    caseSensitive: boolean,
  ) => string | null;
  download: (name: string) => import('@enonic-types/core').ByteSource | null;
}

interface XpBeans {
  'com.enonic.app.datakit.LogManager': LogManager;
}
