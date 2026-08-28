import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_CLASS,
  LEVEL_CLASS,
  logLineClass,
  parseLogLine,
} from '../../../../../main/resources/assets/js/components/log-viewer/log-line';

describe('parseLogLine', () => {
  it('should parse a standard logback entry', () => {
    const parsed = parseLogLine(
      '10:23:45.123 INFO  com.enonic.xp.web.WebDispatcherServlet - Started dispatcher',
    );

    expect(parsed).toEqual({
      kind: 'entry',
      time: '10:23:45.123',
      level: 'INFO',
      logger: 'com.enonic.xp.web.WebDispatcherServlet',
      message: 'Started dispatcher',
    });
  });

  it('should parse every level', () => {
    for (const level of ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']) {
      const parsed = parseLogLine(`00:00:00.000 ${level} a.b.C - msg`);
      expect(parsed).toMatchObject({ kind: 'entry', level });
    }
  });

  it('should keep an empty message', () => {
    expect(parseLogLine('00:00:00.000 WARN  a.b.C - ')).toMatchObject({ message: '' });
  });

  it('should keep " - " inside the message', () => {
    expect(parseLogLine('00:00:00.000 INFO  a.b.C - x - y - z')).toMatchObject({
      message: 'x - y - z',
    });
  });

  it('should treat stack frames as continuations', () => {
    expect(parseLogLine('\tat com.enonic.xp.Foo.run(Foo.java:42)')).toEqual({
      kind: 'continuation',
    });
    expect(parseLogLine('java.lang.IllegalStateException: boom')).toEqual({
      kind: 'continuation',
    });
    expect(parseLogLine('')).toEqual({ kind: 'continuation' });
  });

  it('should reject a malformed timestamp or unknown level', () => {
    expect(parseLogLine('10:23:45 INFO  a.b.C - msg')).toEqual({ kind: 'continuation' });
    expect(parseLogLine('10:23:45.123 FATAL a.b.C - msg')).toEqual({ kind: 'continuation' });
  });

  it('should return the full message of a very long line', () => {
    const message = 'x'.repeat(200_000);
    const parsed = parseLogLine(`10:23:45.123 ERROR a.b.C - ${message}`);

    expect(parsed).toMatchObject({ kind: 'entry', level: 'ERROR' });
    if (parsed.kind !== 'entry') throw new Error('expected an entry');
    expect(parsed.message).toHaveLength(200_000);
  });

  it('should not scan a huge line for a prefix that is not there', () => {
    // ? Only the head is examined, so a " - " far into the payload never counts.
    const parsed = parseLogLine(`${'x'.repeat(1000)} - tail`);
    expect(parsed).toEqual({ kind: 'continuation' });
  });
});

describe('logLineClass', () => {
  it('should map a level to its colour class', () => {
    expect(logLineClass(parseLogLine('00:00:00.000 ERROR a.b.C - x'))).toBe(LEVEL_CLASS.ERROR);
    expect(logLineClass(parseLogLine('00:00:00.000 WARN  a.b.C - x'))).toBe(LEVEL_CLASS.WARN);
    expect(logLineClass(parseLogLine('00:00:00.000 INFO  a.b.C - x'))).toBe(LEVEL_CLASS.INFO);
  });

  it('should dim continuation lines', () => {
    expect(logLineClass({ kind: 'continuation' })).toBe(CONTINUATION_CLASS);
  });

  it('should not reuse any level colour for continuation lines', () => {
    expect(Object.values(LEVEL_CLASS)).not.toContain(CONTINUATION_CLASS);
  });
});
