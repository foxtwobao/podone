import { describe, expect, it } from 'vitest';
import { boardDisplayName, formatFileSize, isValidRedirectTarget } from './format';

describe('format helpers', () => {
  it('validates safe in-app redirect targets', () => {
    expect(isValidRedirectTarget('/bind?code=123456')).toBe(true);
    expect(isValidRedirectTarget('/')).toBe(true);
    expect(isValidRedirectTarget('//evil.example')).toBe(false);
    expect(isValidRedirectTarget('https://evil.example')).toBe(false);
    expect(isValidRedirectTarget('/login')).toBe(false);
    expect(isValidRedirectTarget('/auth/idone/callback')).toBe(false);
  });

  it('formats board names and firmware file sizes', () => {
    expect(boardDisplayName('waveshare-1.75c')).toBe('Pod 1.75C 圆屏');
    expect(boardDisplayName('custom-board')).toBe('custom-board');
    expect(formatFileSize(1024 * 1024 * 4.5)).toBe('4.50 MB');
    expect(formatFileSize(0)).toBe('-');
  });
});
