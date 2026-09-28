/** Cover-band grid and modifier math for ATOB FOH staffing. */

export type Roster = {
  servers: number;
  busser: number;
  host: number;
  hostAsst: number;
  dishSupport: number;
};

export type BandResult = {
  band: 1 | 2 | 3 | 4 | 5;
  crewName: string;
  label: string;
  coversMin: number;
  coversMax: number | null;
  roster: Roster;
};

/** Auto-detected day conditions (not manager toggles). */
export type DayConditions = {
  rainSnow: boolean;
  extremeTemp: boolean;
  radnorSchoolsClosed: boolean;
  /** Any holiday (US/PA, Jewish, etc.) — display as "Holiday" only. */
  holiday: boolean;
  closed: boolean;
};

/** @deprecated use DayConditions — kept as alias for clarity in tests */
export type ModifierFlags = DayConditions;

export const MODIFIER_PERCENTS = {
  rainSnow: -0.1,
  extremeTemp: -0.05,
  radnorSchoolsClosed: 0.1,
  holiday: 0.15,
} as const;

/** Fixed walk-in cushion added to planning covers every open day (LOCKED). */
export const WALK_IN_COVERS = 18;

export type ConditionChip = {
  key: keyof typeof MODIFIER_PERCENTS | 'closed';
  label: string;
  pctLabel: string;
  percent: number;
};

export const CONDITION_META: ConditionChip[] = [
  { key: 'rainSnow', label: 'Rain / snow', pctLabel: '−10%', percent: -0.1 },
  {
    key: 'extremeTemp',
    label: 'Extreme heat / cold',
    pctLabel: '−5%',
    percent: -0.05,
  },
  {
    key: 'radnorSchoolsClosed',
    label: 'Radnor schools closed',
    pctLabel: '+10%',
    percent: 0.1,
  },
  {
    key: 'holiday',
    label: 'Holiday',
    pctLabel: '+15%',
    percent: 0.15,
  },
];

export const OPENING_SKELETON: Pick<Roster, 'servers' | 'host'> = {
  servers: 2,
  host: 1,
};

export const SERVICE = {
  open: '10:00',
  close: '17:00',
  cutFloorUntil: '15:30', // never cut below skeleton before 3:30 PM
} as const;

const BANDS: BandResult[] = [
  {
    band: 1,
    crewName: 'Skeleton Crew',
    label: '≤49',
    coversMin: 0,
    coversMax: 49,
    roster: { servers: 2, busser: 0, host: 1, hostAsst: 0, dishSupport: 0 },
  },
  {
    band: 2,
    crewName: 'Mid Service',
    label: '50–79',
    coversMin: 50,
    coversMax: 79,
    roster: { servers: 3, busser: 0, host: 1, hostAsst: 0, dishSupport: 0 },
  },
  {
    band: 3,
    crewName: 'Runner Crew',
    label: '80–109',
    coversMin: 80,
    coversMax: 109,
    roster: { servers: 3, busser: 1, host: 1, hostAsst: 0, dishSupport: 1 },
  },
  {
    band: 4,
    crewName: 'Full Floor',
    label: '110–129',
    coversMin: 110,
    coversMax: 129,
    roster: { servers: 4, busser: 1, host: 1, hostAsst: 1, dishSupport: 1 },
  },
  {
    band: 5,
    crewName: 'All Hands',
    label: '130+',
    coversMin: 130,
    coversMax: null,
    roster: { servers: 4, busser: 2, host: 1, hostAsst: 1, dishSupport: 1 },
  },
];

/** Locked cover-band → roster lookup. */
export function getBandForCovers(covers: number): BandResult {
  const n = Math.max(0, Math.floor(covers));
  if (n <= 49) return BANDS[0];
  if (n <= 79) return BANDS[1];
  if (n <= 109) return BANDS[2];
  if (n <= 129) return BANDS[3];
  return BANDS[4];
}

/** Sum of active modifier percentages (additive). Closed is handled separately. */
export function getModifierDelta(flags: DayConditions): number {
  let delta = 0;
  if (flags.rainSnow) delta += MODIFIER_PERCENTS.rainSnow;
  if (flags.extremeTemp) delta += MODIFIER_PERCENTS.extremeTemp;
  if (flags.radnorSchoolsClosed) delta += MODIFIER_PERCENTS.radnorSchoolsClosed;
  if (flags.holiday) delta += MODIFIER_PERCENTS.holiday;
  return delta;
}

/**
 * Apply auto % modifiers to base (booked) covers (before walk-in cushion).
 * Returns rounded covers (never negative). Closed → null.
 */
export function applyModifiers(
  baseCovers: number,
  flags: DayConditions,
): number | null {
  if (flags.closed) return null;
  const delta = getModifierDelta(flags);
  const adjusted = Math.round(baseCovers * (1 + delta));
  return Math.max(0, adjusted);
}

/**
 * Planning covers for roster:
 * (booked × auto modifiers) + fixed walk-in cushion,
 * unless manager override is set (override replaces the whole planning number).
 * Closed → null.
 */
export function getPlanningCovers(
  baseCovers: number,
  flags: DayConditions,
  managerOverride: number | null,
): number | null {
  if (flags.closed) return null;
  if (managerOverride !== null && Number.isFinite(managerOverride)) {
    return Math.max(0, Math.round(managerOverride));
  }
  const modified = applyModifiers(baseCovers, flags);
  if (modified === null) return null;
  return modified + WALK_IN_COVERS;
}

export function defaultConditions(): DayConditions {
  return {
    rainSnow: false,
    extremeTemp: false,
    radnorSchoolsClosed: false,
    holiday: false,
    closed: false,
  };
}

/** @deprecated alias */
export function defaultModifiers(): DayConditions {
  return defaultConditions();
}

/** Active condition chips for the read-only Conditions strip. */
export function getActiveConditions(flags: DayConditions): ConditionChip[] {
  return CONDITION_META.filter((c) => flags[c.key]);
}

export function netModifierPercent(flags: DayConditions): number {
  return Math.round(getModifierDelta(flags) * 100);
}

export function rosterTotalHeads(r: Roster): number {
  return r.servers + r.busser + r.host + r.hostAsst + r.dishSupport;
}

export { BANDS };
