/**
 * Client-side ResyOS import (Today's Spread CSV, Today overview ZIP, or CSV).
 * Prefer Today's Spread (real 15-min curve) when present; else current_booked_covers.
 */

import JSZip from 'jszip';
import type { CurveSlot, SampleDay } from './samples';
import { defaultConditions, SERVICE, WALK_IN_COVERS } from './staffing';
import { formatRunTodayLabel, getTodayIso } from './dates';
import { timeToMinutes } from './pacing';

export type ResyImportSource = 'reservations' | 'overview' | 'todays_spread';

export type ResyImportResult = {
  date: string; // YYYY-MM-DD
  baseCovers: number;
  curve: CurveSlot[];
  source: ResyImportSource;
  reservationCount: number;
};

export class ResyCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResyCsvError';
  }
}

/** Standard 30-min windows 10:00–16:30 (service closes 17:00). */
export function serviceWindows(): string[] {
  const open = timeToMinutes(SERVICE.open);
  const close = timeToMinutes(SERVICE.close);
  const out: string[] = [];
  for (let m = open; m < close; m += 30) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return out;
}

/** 15-min windows 10:00–16:45 for Today's Spread curves. */
export function serviceWindows15(): string[] {
  const open = timeToMinutes(SERVICE.open);
  const close = timeToMinutes(SERVICE.close);
  const out: string[] = [];
  for (let m = open; m < close; m += 15) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return out;
}

/** Minimal RFC4180-ish CSV parse (quoted fields, commas, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, ''); // strip BOM

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ');
}

function findCol(
  headers: string[],
  predicates: Array<(h: string) => boolean>,
): number {
  const norms = headers.map(normHeader);
  for (const pred of predicates) {
    const idx = norms.findIndex(pred);
    if (idx >= 0) return idx;
  }
  return -1;
}

const SKIP_STATUS =
  /\b(cancel+ed|cancelled|no[\s-]?show|noshow|void|deleted|rejected)\b/i;

function shouldIncludeStatus(status: string | undefined): boolean {
  if (!status || !status.trim()) return true;
  if (SKIP_STATUS.test(status)) return false;
  return true;
}

/** Parse party size / covers from a cell (handles "4", "4 guests", etc.). */
export function parseCoversCell(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parse reservation time into HH:MM (24h).
 * Accepts "11:30", "11:30 AM", "1:00 PM", ISO datetime, etc.
 */
export function parseTimeCell(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  const iso = t.match(/T(\d{1,2}):(\d{2})/);
  if (iso) {
    return `${String(Number(iso[1])).padStart(2, '0')}:${iso[2]}`;
  }

  const ampm = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (ampm) {
    let h = Number.parseInt(ampm[1], 10);
    const min = ampm[2];
    const mer = ampm[3].toLowerCase();
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }

  const plain = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (plain) {
    return `${String(Number.parseInt(plain[1], 10)).padStart(2, '0')}:${plain[2]}`;
  }

  return null;
}

/** Normalize assorted date strings to YYYY-MM-DD when possible. */
export function parseDateCell(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const us = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (us) {
    let y = Number.parseInt(us[3], 10);
    if (y < 100) y += 2000;
    const m = String(Number.parseInt(us[1], 10)).padStart(2, '0');
    const d = String(Number.parseInt(us[2], 10)).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

function bucketTime(hhmm: string): string {
  const windows = serviceWindows();
  const mins = timeToMinutes(hhmm);
  const open = timeToMinutes(SERVICE.open);
  const close = timeToMinutes(SERVICE.close);
  if (mins < open) return windows[0];
  if (mins >= close) return windows[windows.length - 1];
  const floored = mins - (mins % 30);
  const h = Math.floor(floored / 60);
  const m = floored % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Flat / simple curve across service windows summing to total. */
export function synthesizeFlatCurve(total: number): CurveSlot[] {
  const windows = serviceWindows();
  const n = windows.length;
  const base = Math.floor(Math.max(0, total) / n);
  let rem = Math.max(0, total) - base * n;
  const peakIdx = windows.indexOf('12:00');
  return windows.map((time, i) => {
    let covers = base;
    if (rem > 0 && i === (peakIdx >= 0 ? peakIdx : Math.floor(n / 2))) {
      covers += rem;
      rem = 0;
    }
    return { time, covers };
  });
}

export function buildCurveFromTimedCovers(
  timed: Array<{ time: string; covers: number }>,
): CurveSlot[] {
  const windows = serviceWindows();
  const map = new Map<string, number>(windows.map((w) => [w, 0]));
  for (const row of timed) {
    const key = bucketTime(row.time);
    map.set(key, (map.get(key) ?? 0) + row.covers);
  }
  return windows.map((time) => ({ time, covers: map.get(time) ?? 0 }));
}

function bucketTime15(hhmm: string): string {
  const windows = serviceWindows15();
  const mins = timeToMinutes(hhmm);
  const open = timeToMinutes(SERVICE.open);
  const close = timeToMinutes(SERVICE.close);
  if (mins < open) return windows[0];
  if (mins >= close) return windows[windows.length - 1];
  const floored = mins - (mins % 15);
  const h = Math.floor(floored / 60);
  const m = floored % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Real Today's Spread curve: 15-min slots, zero-filled across service. */
export function buildSpreadCurve(
  timed: Array<{ time: string; covers: number }>,
): CurveSlot[] {
  const windows = serviceWindows15();
  const map = new Map<string, number>(windows.map((w) => [w, 0]));
  for (const row of timed) {
    const key = bucketTime15(row.time);
    map.set(key, (map.get(key) ?? 0) + row.covers);
  }
  return windows.map((time) => ({ time, covers: map.get(time) ?? 0 }));
}

function looksLikeReservationsHeader(headers: string[]): boolean {
  const norms = headers.map(normHeader);
  const hasTime = norms.some(
    (h) =>
      h === 'time' ||
      h.includes('reservation time') ||
      h.includes('visit time') ||
      h === 'start time' ||
      (h.includes('time') && !h.includes('timezone') && !h.includes('status')),
  );
  const hasParty = norms.some(
    (h) =>
      h.includes('party') ||
      h === 'covers' ||
      h.includes('guests') ||
      h === 'size' ||
      h === 'pax' ||
      h.includes('party size'),
  );
  return hasTime && hasParty;
}

/**
 * Resy Today's Spread: covers by 15-minute service-time interval.
 * Headers resemble "… Service Time AM/PM 15 Minute Interval" + "… Covers".
 */
export function isTodaysSpreadCsv(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const headerJoined = rows[0].map(normHeader).join(' | ');
  const hasIntervalLanguage =
    /15\s*minute/.test(headerJoined) ||
    (/service\s*time/.test(headerJoined) && /interval/.test(headerJoined)) ||
    (/service\s*time/.test(headerJoined) && /am\s*pm/.test(headerJoined));
  const hasCovers = rows[0].some((h) => {
    const n = normHeader(h);
    return n === 'covers' || n.includes('covers');
  });
  if (!hasIntervalLanguage || !hasCovers) return false;
  let timeHits = 0;
  for (let r = 1; r < Math.min(rows.length, 8); r++) {
    if (parseTimeCell(rows[r][0] ?? '') !== null) timeHits++;
  }
  return timeHits >= 1;
}

/** Parse Today's Spread rows → timed slots + base cover sum. */
export function parseTodaysSpread(rows: string[][]): {
  timed: Array<{ time: string; covers: number }>;
  baseCovers: number;
} {
  if (!isTodaysSpreadCsv(rows)) {
    throw new ResyCsvError("Not a Today's Spread CSV.");
  }
  const headers = rows[0];
  const timeIdx = findCol(headers, [
    (h) => h.includes('service time'),
    (h) => h.includes('15 minute'),
    (h) => h.includes('interval') && h.includes('time'),
    (h) => h.includes('time'),
  ]);
  const coversIdx = findCol(headers, [
    (h) => h === 'covers',
    (h) => h.endsWith(' covers'),
    (h) => h.includes('covers') && !h.includes('time'),
    (h) => h.includes('covers'),
  ]);
  if (timeIdx < 0 || coversIdx < 0) {
    throw new ResyCsvError(
      "Could not find service-time / covers columns in Today's Spread CSV.",
    );
  }

  const timed: Array<{ time: string; covers: number }> = [];
  let baseCovers = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c.trim())) continue;
    const time = parseTimeCell(row[timeIdx] ?? '');
    const covers = parseCoversCell(row[coversIdx] ?? '');
    if (time === null || covers === null) continue;
    if (covers <= 0) continue;
    timed.push({ time, covers });
    baseCovers += covers;
  }
  if (timed.length === 0) {
    throw new ResyCsvError("Today's Spread CSV has no timed cover rows.");
  }
  return { timed, baseCovers };
}

function spreadResult(
  timed: Array<{ time: string; covers: number }>,
  baseCovers: number,
  options?: { targetDate?: string },
): ResyImportResult {
  return {
    date: options?.targetDate ?? todayIso(),
    baseCovers,
    curve: buildSpreadCurve(timed),
    source: 'todays_spread',
    reservationCount: timed.length,
  };
}

/**
 * Resy Today widget: today's_reservations_by_status.csv — status labels + covers.
 * Must NOT be summed as the booked total (Done/Seated double-count risk).
 */
export function isStatusBreakdownCsv(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const headerJoined = rows[0].map(normHeader).join(' | ');
  if (
    /reservation status|by status|status custom/.test(headerJoined) ||
    (headerJoined.includes('status') && headerJoined.includes('cover'))
  ) {
    // Confirm body looks like status labels, not times/dates
    const statusish =
      /^(done|seated|confirmed|no show|no-show|check dropped|cancelled|canceled|left|pending|booked|arrived)$/i;
    let hits = 0;
    for (let r = 1; r < Math.min(rows.length, 8); r++) {
      const label = (rows[r][0] ?? '').trim();
      if (statusish.test(label)) hits++;
    }
    return hits >= 1;
  }
  return false;
}

/** Resy Today widget current_booked_covers.csv: header "Covers" + numeric rows. */
export function isCurrentBookedCoversCsv(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const h = normHeader(rows[0][0] ?? '');
  if (h !== 'covers' || rows[0].length > 2) return false;
  // All data cells numeric (duplicates OK — Resy often repeats the same total)
  for (let r = 1; r < rows.length; r++) {
    if (parseCoversCell(rows[r][0] ?? '') === null) return false;
  }
  return true;
}

function looksLikeOverview(rows: string[][]): boolean {
  if (rows.length < 1) return false;
  if (isCurrentBookedCoversCsv(rows)) return true;
  if (isStatusBreakdownCsv(rows)) return false;
  // Only inspect headers / metric keys — not body cells (status "Booked" must not match).
  const keys: string[] = rows[0].map((c) => c.trim().toLowerCase());
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length >= 2) keys.push(rows[r][0].trim().toLowerCase());
  }
  return keys.some((c) =>
    /^(booked covers|current covers|total covers|covers booked|reservation covers|covers|booked)$/.test(
      c,
    ) ||
    (c.includes('booked') && c.includes('cover')) ||
    (c.includes('current') && c.includes('cover')),
  );
}

type ParsedReservation = {
  date: string | null;
  time: string | null;
  covers: number;
  status: string;
};

function parseReservationsTable(
  rows: string[][],
): { reservations: ParsedReservation[]; headers: string[] } {
  const headers = rows[0];
  const timeIdx = findCol(headers, [
    (h) => h === 'time',
    (h) => h.includes('reservation time'),
    (h) => h.includes('visit time'),
    (h) => h === 'start time',
    (h) => h.includes('time') && !h.includes('date') && !h.includes('zone'),
  ]);
  const coversIdx = findCol(headers, [
    (h) => h === 'party size' || h === 'party',
    (h) => h.includes('party size'),
    (h) => h === 'covers' || h.includes('covers'),
    (h) => h === 'guests' || h.includes('guest count') || h.includes('num guests'),
    (h) => h === 'size' || h === 'pax' || h === '# guests',
  ]);
  const statusIdx = findCol(headers, [
    (h) => h === 'status',
    (h) => h.includes('reservation status'),
    (h) => h.includes('booking status'),
  ]);
  const dateIdx = findCol(headers, [
    (h) => h === 'date',
    (h) => h === 'reservation date' || h.includes('visit date'),
    (h) => h.includes('service date'),
    (h) => h === 'day',
  ]);

  if (coversIdx < 0) {
    throw new ResyCsvError(
      'Could not find a party size / covers column in the CSV.',
    );
  }

  const reservations: ParsedReservation[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c.trim())) continue;
    const covers = parseCoversCell(row[coversIdx] ?? '');
    if (covers === null || covers <= 0) continue;
    const status = statusIdx >= 0 ? (row[statusIdx] ?? '') : '';
    if (!shouldIncludeStatus(status)) continue;
    const time = timeIdx >= 0 ? parseTimeCell(row[timeIdx] ?? '') : null;
    const date = dateIdx >= 0 ? parseDateCell(row[dateIdx] ?? '') : null;
    reservations.push({ date, time, covers, status });
  }

  return { reservations, headers };
}

function pickTargetDate(
  reservations: ParsedReservation[],
  preferred?: string,
): string {
  if (preferred) return preferred;
  const counts = new Map<string, number>();
  for (const r of reservations) {
    if (!r.date) continue;
    counts.set(r.date, (counts.get(r.date) ?? 0) + r.covers);
  }
  if (counts.size === 0) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  let best = '';
  let bestN = -1;
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

function todayIso(): string {
  return getTodayIso();
}

/**
 * Overview / widget totals.
 * For Resy current_booked_covers.csv (`Covers\\n56\\n56`), use the first
 * non-empty numeric (duplicates are the same total — do NOT sum).
 */
export function parseOverviewCovers(rows: string[][]): {
  baseCovers: number;
  date: string | null;
} {
  if (isStatusBreakdownCsv(rows)) {
    throw new ResyCsvError(
      "Skipping status-breakdown CSV (today's_reservations_by_status). Use current_booked_covers.csv or the Today Download ZIP.",
    );
  }

  // Fast path: Resy Today current_booked_covers.csv
  if (isCurrentBookedCoversCsv(rows)) {
    for (let r = 1; r < rows.length; r++) {
      const v = parseCoversCell(rows[r][0] ?? '');
      if (v !== null) return { baseCovers: v, date: null };
    }
  }

  let booked: number | null = null;
  let current: number | null = null;
  let total: number | null = null;
  let date: string | null = null;

  for (const row of rows) {
    const joined = row.map((c) => c.trim()).filter(Boolean);
    if (joined.length === 0) continue;

    if (joined.length >= 2) {
      const key = joined[0].toLowerCase();
      const val = parseCoversCell(joined[1]);
      const dateVal = parseDateCell(joined[1]);
      if (/date/.test(key) && dateVal) date = dateVal;

      if (val !== null) {
        if (/booked/.test(key) && /cover/.test(key)) booked = val;
        else if (/^booked covers$/.test(key) || key === 'booked') booked = val;
        else if (/current/.test(key) && /cover/.test(key)) current = val;
        else if (/reservation/.test(key) && /cover/.test(key)) booked = val;
        else if (
          (/total/.test(key) && /cover/.test(key)) ||
          key === 'covers'
        ) {
          total = val;
        } else if (key.includes('covers booked')) {
          booked = val;
        }
      }
    }

    for (const cell of joined) {
      const m = cell.match(
        /(booked\s*covers|current\s*covers|reservation\s*covers)\s*[:=]?\s*(\d+)/i,
      );
      if (m) {
        const n = Number.parseInt(m[2], 10);
        if (/booked|reservation/i.test(m[1])) booked = n;
        else current = n;
      }
      const dm = cell.match(
        /(?:date|for)\s*[:=]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      );
      if (dm) date = parseDateCell(dm[1]);
    }
  }

  // Header row with a covers / booked column — take FIRST numeric, do not sum
  // (Resy widgets often duplicate the same total on multiple rows).
  if (booked === null && current === null && total === null && rows.length >= 2) {
    const headers = rows[0].map(normHeader);
    const coversIdx = headers.findIndex(
      (h) =>
        h.includes('booked') ||
        h === 'covers' ||
        h.includes('current covers') ||
        h.includes('reservation covers'),
    );
    if (coversIdx >= 0) {
      for (let r = 1; r < rows.length; r++) {
        const v = parseCoversCell(rows[r][coversIdx] ?? '');
        if (v !== null) {
          total = v;
          break;
        }
      }
    }
  }

  const baseCovers = booked ?? current ?? total;
  if (baseCovers === null) {
    throw new ResyCsvError(
      'Could not find a booked/current covers total in the CSV.',
    );
  }

  return { baseCovers, date };
}

function overviewResult(
  baseCovers: number,
  date: string | null,
  options?: { targetDate?: string },
): ResyImportResult {
  return {
    date: options?.targetDate ?? date ?? todayIso(),
    baseCovers,
    curve: synthesizeFlatCurve(baseCovers),
    source: 'overview',
    reservationCount: 0,
  };
}

/**
 * Parse a ResyOS CSV export into booked covers + pacing curve.
 * Prefers Today's Spread (real 15-min curve), then current_booked_covers /
 * overview totals, then reservations lists. Never treats status-breakdown
 * widgets as the booked total.
 */
export function parseResyCsv(
  csvText: string,
  options?: { targetDate?: string },
): ResyImportResult {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new ResyCsvError('CSV is empty.');
  }

  if (isStatusBreakdownCsv(rows)) {
    throw new ResyCsvError(
      "This CSV is a status breakdown (Done/Seated/…), not current booked covers. Use Today's Spread, current_booked_covers.csv, or the Today Download ZIP.",
    );
  }

  const header = rows[0];

  // Today's Spread: real covers-by-15-min curve (before reservations-style match)
  if (isTodaysSpreadCsv(rows)) {
    const { timed, baseCovers } = parseTodaysSpread(rows);
    return spreadResult(timed, baseCovers, options);
  }

  // Resy Today widget: Covers / 56 / 56
  if (isCurrentBookedCoversCsv(rows)) {
    const { baseCovers, date } = parseOverviewCovers(rows);
    return overviewResult(baseCovers, date, options);
  }

  // Timed reservation lists (if available) before generic overview totals
  if (looksLikeReservationsHeader(header)) {
    const { reservations } = parseReservationsTable(rows);
    if (reservations.length === 0) {
      throw new ResyCsvError(
        'No confirmed/booked reservations with covers found.',
      );
    }
    const date = pickTargetDate(reservations, options?.targetDate);
    const forDay = reservations.filter((r) => !r.date || r.date === date);
    const usable = forDay.length > 0 ? forDay : reservations;
    const baseCovers = usable.reduce((a, r) => a + r.covers, 0);
    const timed = usable
      .filter((r): r is ParsedReservation & { time: string } => r.time !== null)
      .map((r) => ({ time: r.time, covers: r.covers }));

    const curve =
      timed.length > 0
        ? buildCurveFromTimedCovers(timed)
        : synthesizeFlatCurve(baseCovers);

    if (timed.length > 0 && timed.length < usable.length) {
      const timedSum = timed.reduce((a, t) => a + t.covers, 0);
      const leftover = baseCovers - timedSum;
      if (leftover > 0) {
        const peak = curve.reduce(
          (best, s, i) => (s.covers > curve[best].covers ? i : best),
          0,
        );
        curve[peak] = {
          ...curve[peak],
          covers: curve[peak].covers + leftover,
        };
      }
    }

    return {
      date,
      baseCovers,
      curve,
      source: 'reservations',
      reservationCount: usable.length,
    };
  }

  if (looksLikeOverview(rows)) {
    const { baseCovers, date } = parseOverviewCovers(rows);
    return overviewResult(baseCovers, date, options);
  }

  try {
    const { baseCovers, date } = parseOverviewCovers(rows);
    return overviewResult(baseCovers, date, options);
  } catch (err) {
    if (err instanceof ResyCsvError) throw err;
    throw new ResyCsvError(
      "Unrecognized Resy CSV. Drop Today's Spread, the Today Download ZIP, or current_booked_covers.csv.",
    );
  }
}

function pathEndsWithCurrentBooked(path: string): boolean {
  const norm = path.replace(/\\/g, '/').toLowerCase();
  return (
    norm.endsWith('current_booked_covers.csv') ||
    norm.split('/').pop() === 'current_booked_covers.csv'
  );
}

function pathLooksLikeTodaysSpread(path: string): boolean {
  const norm = path.replace(/\\/g, '/').toLowerCase();
  const base = norm.split('/').pop() ?? '';
  return (
    base.includes('spread') ||
    base.includes('15_minute') ||
    base.includes('15-minute') ||
    base.includes('service_time') ||
    base.includes('service-time')
  );
}

/**
 * Extract preferred CSV text from a Resy Today ZIP.
 * Prefers Today's Spread (real curve) over current_booked_covers; skips
 * status-breakdown widgets.
 */
export async function extractBookedCoversCsvFromZip(
  data: ArrayBuffer | Uint8Array,
): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const csvMembers = names.filter((n) => n.toLowerCase().endsWith('.csv'));

  // 1) Prefer Today's Spread by filename, then by content scan
  const spreadByName = csvMembers.find(pathLooksLikeTodaysSpread);
  if (spreadByName) {
    const text = await zip.files[spreadByName].async('string');
    const rows = parseCsv(text);
    if (isTodaysSpreadCsv(rows)) return text;
  }
  for (const name of csvMembers) {
    const text = await zip.files[name].async('string');
    try {
      const rows = parseCsv(text);
      if (isTodaysSpreadCsv(rows)) return text;
    } catch {
      continue;
    }
  }

  // 2) Fallback: current_booked_covers.csv
  const preferred = names.find(pathEndsWithCurrentBooked);
  if (preferred) {
    return zip.files[preferred].async('string');
  }

  // 3) Any other overview booked-covers CSV
  for (const name of csvMembers) {
    const text = await zip.files[name].async('string');
    try {
      const rows = parseCsv(text);
      if (isStatusBreakdownCsv(rows)) continue;
      if (isCurrentBookedCoversCsv(rows) || looksLikeOverview(rows)) {
        parseOverviewCovers(rows); // validate
        return text;
      }
    } catch {
      continue;
    }
  }

  throw new ResyCsvError(
    "ZIP has no Today's Spread or current_booked_covers.csv. Re-download from ResyOS Reports → Today → Download.",
  );
}

/** Parse a Resy Today overview ZIP into an import result. */
export async function parseResyZip(
  data: ArrayBuffer | Uint8Array,
  options?: { targetDate?: string },
): Promise<ResyImportResult> {
  const csvText = await extractBookedCoversCsvFromZip(data);
  return parseResyCsv(csvText, options);
}

/**
 * Browser/File entry: accept .csv or .zip (Resy Today Download).
 */
export async function importResyFile(
  file: File | Blob,
  options?: { targetDate?: string; fileName?: string },
): Promise<ResyImportResult> {
  const name = (
    options?.fileName ??
    (file instanceof File ? file.name : '') ??
    ''
  ).toLowerCase();
  const isZip =
    name.endsWith('.zip') ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed';

  if (isZip) {
    const buf = await file.arrayBuffer();
    return parseResyZip(buf, options);
  }

  const text = await file.text();
  return parseResyCsv(text, options);
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Stable id for the single imported day slot in the picker. */
export const IMPORTED_DAY_ID = 'imported';

/** Run always treats the loaded day as calendar today. */
export function formatImportedLabel(_dateIso?: string): string {
  return formatRunTodayLabel();
}

/** Build a SampleDay from a successful Resy CSV/ZIP parse. */
export function toImportedSampleDay(result: ResyImportResult): SampleDay {
  const [y, m, d] = result.date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = WEEKDAYS[dt.getDay()] ?? '';
  const sourceNote =
    result.source === 'todays_spread'
      ? `Resy Today's Spread · booked ${result.baseCovers} · +${WALK_IN_COVERS} walk-in cushion still applied`
      : result.source === 'reservations'
        ? `Resy import · ${result.reservationCount} reservation${result.reservationCount === 1 ? '' : 's'} · +${WALK_IN_COVERS} walk-in cushion still applied`
        : `Resy Today overview · booked ${result.baseCovers} · +${WALK_IN_COVERS} walk-in cushion still applied`;

  return {
    id: IMPORTED_DAY_ID,
    label: formatImportedLabel(result.date),
    date: result.date,
    weekday,
    baseCovers: result.baseCovers,
    note: sourceNote,
    autoConditions: defaultConditions(),
    curve: result.curve,
  };
}

/**
 * Run-mode backup: manager types booked covers when no Resy CSV is available.
 * Builds an imported-style day with a flat/default service curve so Add/Cut still work.
 * Locked +18 cushion and auto modifiers apply via normal planning math (default = none).
 */
export function createTypedBookedDay(
  bookedCovers: number,
  options?: { label?: string; date?: string },
): SampleDay {
  const n = Math.max(0, Math.round(Number(bookedCovers)));
  if (!Number.isFinite(n)) {
    throw new ResyCsvError('Booked covers must be a number.');
  }
  const date = options?.date ?? todayIso();
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  const weekday = WEEKDAYS[dt.getDay()] ?? '';
  const custom = options?.label?.trim();
  const label = custom
    ? custom.startsWith('Today') ||
        custom.startsWith('Typed') ||
        custom.startsWith('Imported')
      ? custom
      : `Today · ${custom}`
    : formatRunTodayLabel();

  return {
    id: IMPORTED_DAY_ID,
    label,
    date,
    weekday,
    baseCovers: n,
    note: `Typed booked covers · ${n} · flat curve · +${WALK_IN_COVERS} walk-in cushion still applied`,
    autoConditions: defaultConditions(),
    curve: synthesizeFlatCurve(n),
  };
}
