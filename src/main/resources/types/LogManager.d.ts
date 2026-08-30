declare interface LogManager {
  list: () => string;
  /**
   * `{"line":L,"time":"HH:mm:ss.SSS"}` — the physical line the last `minutes` of the file begin
   * at. Both `0` and `null` when nothing is cut, which is also the answer for a window reaching
   * back past midnight: a log line carries no date to order it across that boundary.
   *
   * The line is resolved once and then held by the caller as `start`, so the view only ever
   * grows at its end. A window recomputed per request would instead drop lines off its front as
   * the file grew, shifting every position the client had cached.
   */
  window: (name: string, minutes: number) => string | null;
  /**
   * File metadata with a per-level line count, plus `filtered` when `mask` selects a strict
   * subset of the levels or `start` cuts the head off the file.
   */
  info: (name: string, mask: number, start: number) => string | null;
  /**
   * A page of lines. `from` and the reported total count physical lines when `mask` admits every
   * level and `start` is `0`, and positions in the narrowed view otherwise — in which case the
   * response also carries the physical line number of every line it returns.
   */
  read: (name: string, from: number, count: number, mask: number, start: number) => string | null;
  /**
   * `{"position":N,"visible":boolean}` — where a physical line sits in the narrowed view, falling
   * back to the nearest visible position when the filter hides it or `start` is past it.
   */
  locate: (name: string, mask: number, line: number, start: number) => string | null;
  /**
   * The next match among the lines `mask` admits at or after `start`, with the count around it:
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
    start: number,
  ) => string | null;
  /**
   * One bounded slice of the whole-file match count, as
   * `{"status":"ok","total":T,"levels":[..],"scanned":S,"lines":N,"complete":B}`. Call again
   * while `complete` is false. Takes no mask: `levels` splits every match by level, so the
   * caller derives what its own filter shows and hides without the scan being invalidated.
   * `start` narrows `total` and `levels` the same way, never the scan `scanned` reports.
   */
  matches: (
    name: string,
    query: string,
    regex: boolean,
    caseSensitive: boolean,
    start: number,
  ) => string | null;
  /** The file, or the slice of it from physical line `start` on. */
  download: (name: string, start: number) => import('@enonic-types/core').ByteSource | null;
}

interface XpBeans {
  'com.enonic.app.datakit.LogManager': LogManager;
}
