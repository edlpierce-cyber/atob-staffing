import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildCurveFromTimedCovers,
  buildSpreadCurve,
  extractBookedCoversCsvFromZip,
  isStatusBreakdownCsv,
  isTodaysSpreadCsv,
  parseCsv,
  parseCoversCell,
  parseDateCell,
  parseResyCsv,
  parseResyZip,
  parseTimeCell,
  parseTodaysSpread,
  synthesizeFlatCurve,
  toImportedSampleDay,
  createTypedBookedDay,
  serviceWindows,
  serviceWindows15,
  IMPORTED_DAY_ID,
} from './resyCsv';
import JSZip from 'jszip';
import { WALK_IN_COVERS, getPlanningCovers, getBandForCovers, defaultConditions } from './staffing';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures',
);

describe('parseCsv', () => {
  it('splits simple rows and quoted commas', () => {
    const rows = parseCsv('a,b,"c,d"\n1,2,"3,4"\n');
    expect(rows).toEqual([
      ['a', 'b', 'c,d'],
      ['1', '2', '3,4'],
    ]);
  });
});

describe('cell parsers', () => {
  it('parseCoversCell', () => {
    expect(parseCoversCell('4')).toBe(4);
    expect(parseCoversCell('4 guests')).toBe(4);
    expect(parseCoversCell('')).toBeNull();
  });

  it('parseTimeCell handles 24h and am/pm', () => {
    expect(parseTimeCell('11:30')).toBe('11:30');
    expect(parseTimeCell('1:00 PM')).toBe('13:00');
    expect(parseTimeCell('12:15 AM')).toBe('00:15');
    expect(parseTimeCell('2026-09-23T14:30:00')).toBe('14:30');
  });

  it('parseDateCell', () => {
    expect(parseDateCell('2026-09-23')).toBe('2026-09-23');
    expect(parseDateCell('9/23/2026')).toBe('2026-09-23');
  });
});

describe('curve helpers', () => {
  it('service windows are 30-min from 10:00 to 16:30', () => {
    const w = serviceWindows();
    expect(w[0]).toBe('10:00');
    expect(w[w.length - 1]).toBe('16:30');
    expect(w).toHaveLength(14);
  });

  it('synthesizeFlatCurve sums to total', () => {
    const curve = synthesizeFlatCurve(95);
    expect(curve.reduce((a, s) => a + s.covers, 0)).toBe(95);
  });

  it('buildCurveFromTimedCovers buckets into 30-min windows', () => {
    const curve = buildCurveFromTimedCovers([
      { time: '11:15', covers: 4 },
      { time: '11:45', covers: 2 },
      { time: '12:00', covers: 6 },
    ]);
    expect(curve.find((s) => s.time === '11:00')?.covers).toBe(4);
    expect(curve.find((s) => s.time === '11:30')?.covers).toBe(2);
    expect(curve.find((s) => s.time === '12:00')?.covers).toBe(6);
  });

  it('serviceWindows15 are 15-min from 10:00 to 16:45', () => {
    const w = serviceWindows15();
    expect(w[0]).toBe('10:00');
    expect(w[w.length - 1]).toBe('16:45');
    expect(w).toHaveLength(28);
  });

  it('buildSpreadCurve zero-fills 15-min slots and keeps exact times', () => {
    const curve = buildSpreadCurve([
      { time: '11:15', covers: 4 },
      { time: '11:45', covers: 2 },
      { time: '12:00', covers: 6 },
    ]);
    expect(curve.find((s) => s.time === '11:15')?.covers).toBe(4);
    expect(curve.find((s) => s.time === '11:30')?.covers).toBe(0);
    expect(curve.find((s) => s.time === '11:45')?.covers).toBe(2);
    expect(curve.find((s) => s.time === '12:00')?.covers).toBe(6);
    expect(curve.reduce((a, s) => a + s.covers, 0)).toBe(12);
  });
});

describe('parseResyCsv — reservations style', () => {
  const reservationsCsv = [
    'Date,Time,Party Size,Status,Service,Guest',
    '2026-09-23,10:30,2,Confirmed,Lunch,Ada',
    '2026-09-23,11:00,4,Booked,Lunch,Ben',
    '2026-09-23,12:00,6,Confirmed,Lunch,Cam',
    '2026-09-23,12:30,3,Cancelled,Lunch,Dee',
    '2026-09-23,13:00,2,No-Show,Lunch,Eve',
    '2026-09-23,14:00,5,Seated,Lunch,Fay',
    '2026-09-22,12:00,8,Confirmed,Lunch,OtherDay',
  ].join('\n');

  it('sums covers for target date and skips cancelled/no-show', () => {
    const result = parseResyCsv(reservationsCsv, { targetDate: '2026-09-23' });
    expect(result.baseCovers).toBe(17);
    expect(result.source).toBe('reservations');
    expect(result.date).toBe('2026-09-23');
    expect(result.reservationCount).toBe(4);
    expect(result.curve.reduce((a, s) => a + s.covers, 0)).toBe(17);
    expect(result.curve.find((s) => s.time === '12:00')?.covers).toBe(6);
  });

  it('picks the date with the most covers when no targetDate', () => {
    const result = parseResyCsv(reservationsCsv);
    expect(result.date).toBe('2026-09-23');
    expect(result.baseCovers).toBe(17);
  });

  it('toImportedSampleDay labels clearly and keeps booked as baseCovers', () => {
    const result = parseResyCsv(reservationsCsv, { targetDate: '2026-09-23' });
    const day = toImportedSampleDay(result);
    expect(day.id).toBe(IMPORTED_DAY_ID);
    expect(day.label).toMatch(/^Today · /);
    expect(day.baseCovers).toBe(17);
    const planning = getPlanningCovers(
      day.baseCovers,
      defaultConditions(),
      null,
    );
    expect(planning).toBe(17 + WALK_IN_COVERS);
  });
});

describe('parseResyCsv — overview / totals style', () => {
  it('reads Booked Covers from a key/value summary', () => {
    const csv = [
      'Metric,Value',
      'Date,2026-09-23',
      'Booked Covers,95',
      'Walk-ins,2',
      'Current Covers,97',
    ].join('\n');
    const result = parseResyCsv(csv);
    expect(result.source).toBe('overview');
    expect(result.baseCovers).toBe(95);
    expect(result.date).toBe('2026-09-23');
    expect(result.curve.reduce((a, s) => a + s.covers, 0)).toBe(95);
  });

  it('reads a simple totals header row', () => {
    const csv = 'Booked Covers,Walk-ins\n88,2\n';
    const result = parseResyCsv(csv);
    expect(result.baseCovers).toBe(88);
    expect(result.source).toBe('overview');
  });
});

describe('Resy Today fixtures (real export)', () => {
  it('current_booked_covers.csv → baseCovers 56 (does not sum duplicate rows)', () => {
    const text = readFileSync(
      join(FIXTURES, 'resy-today-overview.csv'),
      'utf8',
    );
    expect(text.trim()).toBe('Covers\n56\n56');
    const result = parseResyCsv(text);
    expect(result.source).toBe('overview');
    expect(result.baseCovers).toBe(56);
    expect(result.curve.reduce((a, s) => a + s.covers, 0)).toBe(56);
  });

  it('unzipped current_booked_covers.csv also → 56', () => {
    const text = readFileSync(
      join(
        FIXTURES,
        'today_overview/dashboard-today_overview/current_booked_covers.csv',
      ),
      'utf8',
    );
    expect(parseResyCsv(text).baseCovers).toBe(56);
  });

  it('status-breakdown CSV is rejected (not summed as booked)', () => {
    const text = readFileSync(
      join(
        FIXTURES,
        "today_overview/dashboard-today_overview/today's_reservations_by_status.csv",
      ),
      'utf8',
    );
    const rows = parseCsv(text);
    expect(isStatusBreakdownCsv(rows)).toBe(true);
    expect(() => parseResyCsv(text)).toThrow(/status breakdown/i);
  });

  it('Today overview ZIP → extracts current_booked_covers → 56', async () => {
    const buf = readFileSync(join(FIXTURES, 'resy-today-overview.zip'));
    const csvText = await extractBookedCoversCsvFromZip(buf);
    expect(csvText).toMatch(/Covers/);
    expect(csvText).toMatch(/56/);
    const result = await parseResyZip(buf);
    expect(result.baseCovers).toBe(56);
    expect(result.source).toBe('overview');
    const day = toImportedSampleDay(result);
    expect(day.baseCovers).toBe(56);
    expect(getPlanningCovers(day.baseCovers, defaultConditions(), null)).toBe(
      56 + WALK_IN_COVERS,
    );
  });
});

describe("parseResyCsv — Today's Spread", () => {
  const spreadText = readFileSync(join(FIXTURES, 'todays-spread.csv'), 'utf8');

  it('detects Edward\'s sample headers as Today\'s Spread', () => {
    const rows = parseCsv(spreadText);
    expect(isTodaysSpreadCsv(rows)).toBe(true);
    expect(isStatusBreakdownCsv(rows)).toBe(false);
  });

  it('parses sample → baseCovers 56 + real 15-min curve', () => {
    const result = parseResyCsv(spreadText, { targetDate: '2026-09-23' });
    expect(result.source).toBe('todays_spread');
    expect(result.baseCovers).toBe(56);
    expect(result.date).toBe('2026-09-23');
    expect(result.curve.reduce((a, s) => a + s.covers, 0)).toBe(56);
    expect(result.curve.find((s) => s.time === '10:00')?.covers).toBe(2);
    expect(result.curve.find((s) => s.time === '10:15')?.covers).toBe(0);
    expect(result.curve.find((s) => s.time === '11:15')?.covers).toBe(5);
    expect(result.curve.find((s) => s.time === '12:30')?.covers).toBe(7);
    expect(result.curve.find((s) => s.time === '12:45')?.covers).toBe(7);
    expect(result.curve.find((s) => s.time === '14:00')?.covers).toBe(2);
    expect(result.curve).toHaveLength(28);
  });

  it('parseTodaysSpread sums interval covers', () => {
    const { timed, baseCovers } = parseTodaysSpread(parseCsv(spreadText));
    expect(baseCovers).toBe(56);
    expect(timed).toHaveLength(13);
  });

  it('toImportedSampleDay notes Today\'s Spread', () => {
    const day = toImportedSampleDay(parseResyCsv(spreadText));
    expect(day.baseCovers).toBe(56);
    expect(day.note).toMatch(/Today's Spread/i);
    expect(
      getPlanningCovers(day.baseCovers, defaultConditions(), null),
    ).toBe(56 + WALK_IN_COVERS);
  });

  it('still prefers spread over looking like a reservations table', () => {
    // Header has time + covers language; must not take reservations path
    const result = parseResyCsv(spreadText);
    expect(result.source).toBe('todays_spread');
    // Flat overview synthesis would put remainder on 12:00 — spread keeps 4 at noon
    expect(result.curve.find((s) => s.time === '12:00')?.covers).toBe(4);
  });
});

describe("ZIP prefers Today's Spread over current_booked_covers", () => {
  it('extracts spread when both members exist', async () => {
    const zip = new JSZip();
    zip.file(
      'dashboard/current_booked_covers.csv',
      'Covers\n99\n99\n',
    );
    zip.file(
      'dashboard/todays-spread.csv',
      readFileSync(join(FIXTURES, 'todays-spread.csv'), 'utf8'),
    );
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const csvText = await extractBookedCoversCsvFromZip(buf);
    expect(csvText).toMatch(/15 Minute Interval/i);
    const result = await parseResyZip(buf);
    expect(result.source).toBe('todays_spread');
    expect(result.baseCovers).toBe(56);
    expect(result.curve.find((s) => s.time === '12:30')?.covers).toBe(7);
  });

  it('falls back to current_booked_covers when no spread', async () => {
    const buf = readFileSync(join(FIXTURES, 'resy-today-overview.zip'));
    const result = await parseResyZip(buf);
    expect(result.source).toBe('overview');
    expect(result.baseCovers).toBe(56);
  });
});


describe('createTypedBookedDay (Run typed-covers backup)', () => {
  it('builds imported-slot day with flat curve summing to booked', () => {
    const day = createTypedBookedDay(95);
    expect(day.id).toBe(IMPORTED_DAY_ID);
    expect(day.baseCovers).toBe(95);
    expect(day.curve.reduce((a, s) => a + s.covers, 0)).toBe(95);
    expect(day.autoConditions).toEqual(defaultConditions());
    expect(day.label).toMatch(/^Today · /);
    expect(day.note).toMatch(/flat curve/i);
  });

  it('applies optional custom label', () => {
    const day = createTypedBookedDay(80, { label: 'Tue Sep 30' });
    expect(day.label).toBe('Today · Tue Sep 30');
  });

  it('planning covers = typed base + walk-in cushion (no modifiers)', () => {
    const day = createTypedBookedDay(100);
    const planning = getPlanningCovers(day.baseCovers, day.autoConditions, null);
    expect(planning).toBe(100 + WALK_IN_COVERS);
    expect(getBandForCovers(planning!).band).toBe(4); // 118 → band 4
  });
});

describe('Build mode projected covers math', () => {
  it('projected base + cushion with default conditions → planning → band', () => {
    // Same formula as Run: planning = base × modifiers + 18
    const projected = 120;
    const planning = getPlanningCovers(projected, defaultConditions(), null);
    expect(planning).toBe(120 + WALK_IN_COVERS); // 138 → Band 5
    expect(getBandForCovers(planning!).band).toBe(5);
  });

  it('small projected still gets cushion before banding', () => {
    const planning = getPlanningCovers(40, defaultConditions(), null);
    expect(planning).toBe(40 + WALK_IN_COVERS); // 58 → Band 2
    expect(getBandForCovers(planning!).band).toBe(2);
  });
});
