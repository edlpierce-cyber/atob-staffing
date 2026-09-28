import { describe, expect, it } from 'vitest';
import {
  formatBuildDateLabel,
  formatRunTodayLabel,
  formatTodayLabel,
  getTodayIso,
} from './dates';

describe('formatBuildDateLabel', () => {
  it('formats YYYY-MM-DD as weekday short month day year', () => {
    expect(formatBuildDateLabel('2026-09-30')).toBe('Wed, Sep 30, 2026');
  });

  it('formats another weekday correctly', () => {
    expect(formatBuildDateLabel('2026-09-19')).toBe('Sat, Sep 19, 2026');
  });

  it('returns empty for blank or invalid input', () => {
    expect(formatBuildDateLabel('')).toBe('');
    expect(formatBuildDateLabel('  ')).toBe('');
    expect(formatBuildDateLabel('not-a-date')).toBe('');
    expect(formatBuildDateLabel('2026-02-31')).toBe('');
  });
});

describe('getTodayIso / formatTodayLabel (America/New_York)', () => {
  it('returns YYYY-MM-DD for a fixed instant in NY', () => {
    // 2026-09-23 18:00 UTC = 14:00 EDT
    const noonish = new Date('2026-09-23T18:00:00Z');
    expect(getTodayIso(noonish)).toBe('2026-09-23');
    expect(formatTodayLabel(noonish)).toBe('Wed, Sep 23, 2026');
    expect(formatRunTodayLabel(noonish)).toBe('Today · Wed, Sep 23, 2026');
  });

  it('stays on previous calendar day late evening UTC when still evening in NY', () => {
    // 2026-09-24 03:00 UTC = 2026-09-23 23:00 EDT
    const lateNy = new Date('2026-09-24T03:00:00Z');
    expect(getTodayIso(lateNy)).toBe('2026-09-23');
  });
});
