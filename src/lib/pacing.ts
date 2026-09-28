import type { Roster } from './staffing';
import { OPENING_SKELETON, SERVICE } from './staffing';
import type { CurveSlot } from './samples';

/** Parse HH:MM to minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function formatTime12(t: string): string {
  const [hStr, mStr] = t.split(':');
  let h = Number(hStr);
  const m = mStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

const CUT_FLOOR_MIN = timeToMinutes(SERVICE.cutFloorUntil); // 15:30
const OPEN_MIN = timeToMinutes(SERVICE.open);

/**
 * Locked cut priority (highest priority = cut FIRST / earliest).
 * Support / higher-cost roles before servers.
 * Host (required 1) is never in this list — skeleton with 2 servers until 3:30.
 */
export const CUT_PRIORITY_IDS = [
  'hostAsst',
  'extraBusser',
  'dishSupport',
  'busser',
  'fourthServer',
  'thirdServer',
] as const;

export type CutRoleId = (typeof CUT_PRIORITY_IDS)[number];

export const CUT_ROLE_LABELS: Record<CutRoleId, string> = {
  hostAsst: 'Host Assistant',
  dishSupport: 'Dish Support',
  extraBusser: '2nd Busser',
  busser: 'Busser',
  fourthServer: '4th Server',
  thirdServer: '3rd Server',
};

/** Roles present on the day roster that can be cut, in cut-first order. */
export function getCuttableRoles(dayRoster: Roster): CutRoleId[] {
  const out: CutRoleId[] = [];
  if (dayRoster.hostAsst >= 1) out.push('hostAsst');
  if (dayRoster.busser >= 2) out.push('extraBusser');
  if (dayRoster.dishSupport >= 1) out.push('dishSupport');
  if (dayRoster.busser >= 1) out.push('busser');
  if (dayRoster.servers >= 4) out.push('fourthServer');
  if (dayRoster.servers >= 3) out.push('thirdServer');
  return out;
}

/** Add order = reverse of cut priority (bring servers on first, support later). */
export function getAddableRoles(dayRoster: Roster): CutRoleId[] {
  return [...getCuttableRoles(dayRoster)].reverse();
}

export type PlanStep = {
  time: string;
  roleId: CutRoleId;
  roleLabel: string;
  /** True when suggestion is after 3:30 PM (MOD judgment). */
  modJudgment: boolean;
};

export type DayPlans = {
  addPlan: PlanStep[];
  cutPlan: PlanStep[];
};

/**
 * Target servers for a window: ceil(guests / 15), floored by skeleton,
 * capped by day roster servers.
 */
export function targetServersForWindow(
  guestsInWindow: number,
  dayRosterServers: number,
): number {
  const byLoad = Math.ceil(Math.max(0, guestsInWindow) / 15);
  return Math.min(
    dayRosterServers,
    Math.max(OPENING_SKELETON.servers, byLoad),
  );
}

function sortedCurve(curve: CurveSlot[]): CurveSlot[] {
  return [...curve].sort(
    (a, b) => timeToMinutes(a.time) - timeToMinutes(b.time),
  );
}

function peakIndex(sorted: CurveSlot[]): number {
  let best = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].covers > sorted[best].covers) best = i;
  }
  return best;
}

/**
 * Pick N distinct times from candidates, spread across the list (earliest → latest).
 */
function pickTimes(candidates: string[], count: number): string[] {
  if (count <= 0 || candidates.length === 0) return [];
  if (count >= candidates.length) {
    // Not enough slots — reuse last times as needed while keeping chronological
    const out = [...candidates];
    while (out.length < count) out.push(candidates[candidates.length - 1]);
    return out;
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / Math.max(count - 1, 1)) * (candidates.length - 1));
    out.push(candidates[idx]);
  }
  // Dedupe collisions by walking forward
  const result: string[] = [];
  const used = new Set<number>();
  for (let i = 0; i < out.length; i++) {
    let idx = candidates.indexOf(out[i]);
    while (used.has(idx) && idx < candidates.length - 1) idx++;
    while (used.has(idx) && idx > 0) idx--;
    used.add(idx);
    result.push(candidates[idx]);
  }
  return result;
}

/**
 * Build Add Plan + Cut Plan from the day's cover curve and band roster.
 *
 * - Open with skeleton (2 servers + 1 host) — not listed as adds
 * - Add Plan: extras onboarded after open as the curve rises (before peak)
 * - Cut Plan: cut in LOCKED priority as the curve declines (after peak);
 *   highest-priority roles get the earliest cut times
 * - Before 3:30: never cut below 2 servers + 1 host
 * - After 3:30: remaining cut suggestions labeled MOD judgment
 */
export function buildDayPlans(curve: CurveSlot[], dayRoster: Roster): DayPlans {
  const sorted = sortedCurve(curve);
  if (sorted.length === 0) return { addPlan: [], cutPlan: [] };

  const peak = peakIndex(sorted);
  const addRoles = getAddableRoles(dayRoster);
  const cutRoles = getCuttableRoles(dayRoster);

  // Rising side: slots after open up to and including peak
  const riseCandidates = sorted
    .filter((s, i) => {
      const m = timeToMinutes(s.time);
      return m > OPEN_MIN && i <= peak;
    })
    .map((s) => s.time);

  const addTimesPool =
    riseCandidates.length > 0
      ? riseCandidates
      : sorted
          .filter((s) => timeToMinutes(s.time) >= OPEN_MIN)
          .slice(0, Math.max(1, peak + 1))
          .map((s) => s.time);

  const addTimes = pickTimes(addTimesPool, addRoles.length);
  // addRoles already in add order (3rd server first); assign earliest rise times first
  const addPlan: PlanStep[] = addRoles.map((roleId, i) => ({
    time: addTimes[i] ?? addTimesPool[addTimesPool.length - 1] ?? SERVICE.open,
    roleId,
    roleLabel: CUT_ROLE_LABELS[roleId],
    modJudgment: false,
  }));
  addPlan.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  // Declining side: after peak through close
  const declineCandidates = sorted
    .filter((_, i) => i > peak)
    .map((s) => s.time);

  const cutTimesPool =
    declineCandidates.length > 0
      ? declineCandidates
      : sorted
          .filter((s) => timeToMinutes(s.time) >= timeToMinutes('14:00'))
          .map((s) => s.time);

  const pool =
    cutTimesPool.length > 0 ? cutTimesPool : [SERVICE.cutFloorUntil];
  // Assign earliest decline times to highest-priority cuts
  const cutTimes = pickTimes(pool, cutRoles.length);

  const cutPlan: PlanStep[] = cutRoles.map((roleId, i) => {
    const time = cutTimes[i] ?? pool[pool.length - 1] ?? SERVICE.cutFloorUntil;
    const mins = timeToMinutes(time);
    return {
      time,
      roleId,
      roleLabel: CUT_ROLE_LABELS[roleId],
      modJudgment: mins >= CUT_FLOOR_MIN,
    };
  });

  // Before 3:30: drop any cut that would breach skeleton (none of current roles do)
  const safeCutPlan = cutPlan.filter((step) => {
    if (timeToMinutes(step.time) < CUT_FLOOR_MIN) {
      return isCutSafeBeforeFloor(step.roleId, dayRoster);
    }
    return true;
  });

  // Already in priority order with ascending times — keep chronological for UI
  safeCutPlan.sort((a, b) => {
    const dt = timeToMinutes(a.time) - timeToMinutes(b.time);
    if (dt !== 0) return dt;
    return (
      CUT_PRIORITY_IDS.indexOf(a.roleId) - CUT_PRIORITY_IDS.indexOf(b.roleId)
    );
  });

  return { addPlan, cutPlan: safeCutPlan };
}

/**
 * Before 3:30, a cut is safe only if after applying it we still have
 * ≥2 servers and ≥1 host. Host is never cuttable.
 */
export function isCutSafeBeforeFloor(
  roleId: CutRoleId,
  _dayRoster: Roster,
): boolean {
  return (
    roleId === 'hostAsst' ||
    roleId === 'dishSupport' ||
    roleId === 'extraBusser' ||
    roleId === 'busser' ||
    roleId === 'fourthServer' ||
    roleId === 'thirdServer'
  );
}

/**
 * Simulate applying cuts in priority order for pre-3:30 steps.
 * Returns remaining counts — must keep ≥2 servers + 1 host.
 */
export function remainingAfterCuts(
  dayRoster: Roster,
  cutPlan: PlanStep[],
): {
  servers: number;
  host: number;
  busser: number;
  hostAsst: number;
  dishSupport: number;
} {
  let servers = dayRoster.servers;
  let busser = dayRoster.busser;
  let hostAsst = dayRoster.hostAsst;
  let dishSupport = dayRoster.dishSupport;
  const host = dayRoster.host;

  for (const step of cutPlan) {
    if (timeToMinutes(step.time) >= CUT_FLOOR_MIN) continue;
    switch (step.roleId) {
      case 'hostAsst':
        hostAsst = Math.max(0, hostAsst - 1);
        break;
      case 'dishSupport':
        dishSupport = Math.max(0, dishSupport - 1);
        break;
      case 'extraBusser':
        busser = Math.max(1, busser - 1);
        break;
      case 'busser':
        busser = Math.max(0, busser - 1);
        break;
      case 'fourthServer':
        servers = Math.max(OPENING_SKELETON.servers, servers - 1);
        break;
      case 'thirdServer':
        servers = Math.max(OPENING_SKELETON.servers, servers - 1);
        break;
    }
  }

  return { servers, host, busser, hostAsst, dishSupport };
}
