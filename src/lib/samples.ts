/** Sample Resy-shaped cover curves for demo days. */

import type { DayConditions } from './staffing';
import { defaultConditions } from './staffing';

export type CurveSlot = {
  /** 24h HH:MM start of 30-min window */
  time: string;
  covers: number;
};

export type SampleDay = {
  id: string;
  label: string;
  date: string; // YYYY-MM-DD
  weekday: string;
  /** Booked / base covers from Resy sample */
  baseCovers: number;
  note?: string;
  /** Auto-detected conditions for this sample day (not toggles) */
  autoConditions: DayConditions;
  curve: CurveSlot[];
};

function slots(pairs: Array<[string, number]>): CurveSlot[] {
  return pairs.map(([time, covers]) => ({ time, covers }));
}

function conditions(
  partial: Partial<DayConditions> = {},
): DayConditions {
  return { ...defaultConditions(), ...partial };
}

/** Sat 9/19/2026 — 142 covers, strong all day (no auto modifiers) */
const SAT_SEP_19: SampleDay = {
  id: '2026-09-19',
  label: 'Sat Sep 19',
  date: '2026-09-19',
  weekday: 'Saturday',
  baseCovers: 142,
  note: 'Strong all day — weekend peak',
  autoConditions: conditions(),
  curve: slots([
    ['10:00', 6],
    ['10:30', 8],
    ['11:00', 10],
    ['11:30', 14],
    ['12:00', 18],
    ['12:30', 16],
    ['13:00', 14],
    ['13:30', 12],
    ['14:00', 10],
    ['14:30', 8],
    ['15:00', 8],
    ['15:30', 6],
    ['16:00', 6],
    ['16:30', 6],
  ]),
};

/** Wed 9/16/2026 — 82 covers, noon peak + late secondary bump; light rain demo */
const WED_SEP_16: SampleDay = {
  id: '2026-09-16',
  label: 'Wed Sep 16',
  date: '2026-09-16',
  weekday: 'Wednesday',
  baseCovers: 82,
  note: 'Noon peak + late secondary bump · rain auto-applied',
  autoConditions: conditions({ rainSnow: true }),
  curve: slots([
    ['10:00', 2],
    ['10:30', 3],
    ['11:00', 5],
    ['11:30', 10],
    ['12:00', 14],
    ['12:30', 12],
    ['13:00', 8],
    ['13:30', 4],
    ['14:00', 3],
    ['14:30', 3],
    ['15:00', 4],
    ['15:30', 6],
    ['16:00', 5],
    ['16:30', 3],
  ]),
};

/**
 * Mon 9/21/2026 — 118 booked covers, holiday.
 * Base 118 → +15% → planning 136 → Band 5 · All Hands.
 */
const MON_SEP_21: SampleDay = {
  id: '2026-09-21',
  label: 'Mon Sep 21',
  date: '2026-09-21',
  weekday: 'Monday',
  baseCovers: 118,
  note: 'Holiday — volume may differ from a normal Monday',
  autoConditions: conditions({ holiday: true }),
  curve: slots([
    ['10:00', 4],
    ['10:30', 6],
    ['11:00', 8],
    ['11:30', 12],
    ['12:00', 16],
    ['12:30', 14],
    ['13:00', 12],
    ['13:30', 10],
    ['14:00', 8],
    ['14:30', 6],
    ['15:00', 6],
    ['15:30', 6],
    ['16:00', 5],
    ['16:30', 5],
  ]),
};

export const SAMPLE_DAYS: SampleDay[] = [SAT_SEP_19, WED_SEP_16, MON_SEP_21];

export function getSampleById(id: string): SampleDay | undefined {
  return SAMPLE_DAYS.find((d) => d.id === id);
}

/** Demo/training helper — Run UI no longer auto-selects a sample. */
export function getDefaultSample(todayIso = '2026-09-21'): SampleDay {
  return getSampleById(todayIso) ?? SAMPLE_DAYS[0];
}

/** Build a flat curve scaled to total covers when user enters custom covers. */
export function scaleCurve(
  template: CurveSlot[],
  targetTotal: number,
): CurveSlot[] {
  const sum = template.reduce((a, s) => a + s.covers, 0) || 1;
  const scaled = template.map((s) => ({
    time: s.time,
    covers: Math.round((s.covers / sum) * targetTotal),
  }));
  // Fix rounding drift on the peak slot
  const scaledSum = scaled.reduce((a, s) => a + s.covers, 0);
  const drift = targetTotal - scaledSum;
  if (drift !== 0 && scaled.length > 0) {
    const peak = scaled.reduce(
      (best, s, i) => (s.covers > scaled[best].covers ? i : best),
      0,
    );
    scaled[peak] = {
      ...scaled[peak],
      covers: Math.max(0, scaled[peak].covers + drift),
    };
  }
  return scaled;
}
