/**
 * Date helpers for managers (America/New_York / en-US).
 */

const NY = 'America/New_York';

/**
 * Format an HTML date input value (YYYY-MM-DD) for managers.
 * Uses calendar date parts in UTC so the day never shifts by timezone.
 * Example: "2026-09-30" → "Tue, Sep 30, 2026"
 */
export function formatBuildDateLabel(isoDate: string): string {
  const trimmed = isoDate.trim();
  if (!trimmed) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return '';
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // Guard against JS Date overflow (e.g. 2026-02-31 → Mar)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Calendar YYYY-MM-DD for "today" in America/New_York. */
export function getTodayIso(now: Date = new Date()): string {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Manager-facing label for calendar today in America/New_York.
 * Example: "Wed, Sep 23, 2026"
 */
export function formatTodayLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(now);
}

/** "Today · Wed, Sep 23, 2026" for Run mode day chips / status. */
export function formatRunTodayLabel(now: Date = new Date()): string {
  return `Today · ${formatTodayLabel(now)}`;
}
