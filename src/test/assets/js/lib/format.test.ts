import { describe, expect, it } from 'vitest';

import { formatFileSize } from '../../../../main/resources/assets/js/lib/format';

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [2048, '2.0 KB'],
    [1024 * 1024 - 1, '1024.0 KB'],
    [1024 * 1024, '1.0 MB'],
    [1024 * 1024 * 1024 - 1, '1024.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
    [5 * 1024 * 1024 * 1024, '5.0 GB'],
  ])('should format %i bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  it('should switch unit exactly at the boundary, not one byte early', () => {
    expect(formatFileSize(1023)).toContain('B');
    expect(formatFileSize(1023)).not.toContain('KB');
    expect(formatFileSize(1024)).toContain('KB');
  });
});
