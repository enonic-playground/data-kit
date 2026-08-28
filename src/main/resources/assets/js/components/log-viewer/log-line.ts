//
// * Logback line parsing
//
// XP's default pattern is `%d{HH:mm:ss.SSS} %-5level %logger{36} - %msg%n`, so
// the first line of an entry carries time/level/logger and every following line
// of a stack trace is a continuation.
//

import type { LogLevel } from '../../lib/api/logs';

export type ParsedLogLine =
  | {
      kind: 'entry';
      time: string;
      level: LogLevel;
      logger: string;
      message: string;
    }
  | { kind: 'continuation' };

// ? Anchored, and only ever run against the head of the line: a single log line
// ? can be hundreds of kilobytes and the prefix always fits in far less.
// ! Must stay in step with `classifyHead` in `LogManager.kt`, which decides the same thing on
// ! raw bytes. If the two disagree, the gutter numbers stop matching the colouring.
const ENTRY_PREFIX = /^(\d{2}:\d{2}:\d{2}\.\d{3}) (TRACE|DEBUG|INFO|WARN|ERROR)\s+(\S{1,256}) - /;

const HEAD_LENGTH = 512;

const CONTINUATION: ParsedLogLine = { kind: 'continuation' };

export function parseLogLine(text: string): ParsedLogLine {
  const head = text.length > HEAD_LENGTH ? text.slice(0, HEAD_LENGTH) : text;
  const match = ENTRY_PREFIX.exec(head);
  if (match === null) return CONTINUATION;

  return {
    kind: 'entry',
    time: match[1],
    level: match[2] as LogLevel,
    logger: match[3],
    message: text.slice(match[0].length),
  };
}

/**
 * Colour for the message body, which is also the line's base colour. Entry
 * lines are tinted by severity; continuation lines (stack frames) get their own
 * hue so they read as the body of the entry above them rather than as another
 * DEBUG line.
 */
export const LEVEL_CLASS: Record<LogLevel, string> = {
  TRACE: 'text-text-dimmed',
  DEBUG: 'text-muted-foreground',
  INFO: 'text-foreground',
  WARN: 'text-log-warn',
  ERROR: 'text-log-error',
};

export const CONTINUATION_CLASS = 'text-log-continuation';

// ? Time and logger are needed to place an entry, not to read it, so they sit
// ? below the message; the level token is what the eye scans a log for.
export const TIME_CLASS = 'text-text-dimmed';
export const LOGGER_CLASS = 'text-muted-foreground';
export const LEVEL_EMPHASIS = 'font-semibold';

export function logLineClass(line: ParsedLogLine): string {
  return line.kind === 'entry' ? LEVEL_CLASS[line.level] : CONTINUATION_CLASS;
}
