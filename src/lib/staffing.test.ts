import { describe, expect, it } from 'vitest';
import {
  applyModifiers,
  defaultConditions,
  getActiveConditions,
  getBandForCovers,
  getModifierDelta,
  getPlanningCovers,
  WALK_IN_COVERS,
  MODIFIER_PERCENTS,
  type DayConditions,
} from './staffing';
import {
  buildDayPlans,
  CUT_PRIORITY_IDS,
  CUT_ROLE_LABELS,
  getAddableRoles,
  getCuttableRoles,
  isCutSafeBeforeFloor,
  remainingAfterCuts,
  targetServersForWindow,
  timeToMinutes,
} from './pacing';
import { SAMPLE_DAYS, getDefaultSample } from './samples';

describe('getBandForCovers (locked bands)', () => {
  it('returns the ATOB SOP crew name for every band', () => {
    const expected = [
      [49, 'Skeleton Crew'],
      [50, 'Mid Service'],
      [80, 'Runner Crew'],
      [110, 'Full Floor'],
      [130, 'All Hands'],
    ] as const;

    for (const [covers, crewName] of expected) {
      expect(getBandForCovers(covers).crewName).toBe(crewName);
    }
  });

  it('band 1: ≤49 → 2s/0b/1h', () => {
    for (const n of [0, 1, 49]) {
      const b = getBandForCovers(n);
      expect(b.band).toBe(1);
      expect(b.roster).toEqual({
        servers: 2,
        busser: 0,
        host: 1,
        hostAsst: 0,
        dishSupport: 0,
      });
    }
  });

  it('band 2: 50–79 → 3s/0b/1h', () => {
    for (const n of [50, 79]) {
      expect(getBandForCovers(n).band).toBe(2);
    }
  });

  it('band 3: 80–109 → 3s/1b/1h/1dish', () => {
    for (const n of [80, 109]) {
      expect(getBandForCovers(n).band).toBe(3);
    }
  });

  it('band 4: 110–129 → 4s/1b/1h/1asst/1dish', () => {
    for (const n of [110, 129]) {
      expect(getBandForCovers(n).band).toBe(4);
    }
  });

  it('band 5: 130+ → 4s/2b/1h/1asst/1dish', () => {
    for (const n of [130, 136, 142, 200]) {
      expect(getBandForCovers(n).band).toBe(5);
    }
  });

  it('band selection from planning covers (Mon 21: 118→136+18=154→Band 5)', () => {
    const mon = SAMPLE_DAYS.find((d) => d.id === '2026-09-21')!;
    const modified = applyModifiers(mon.baseCovers, mon.autoConditions)!;
    expect(modified).toBe(136); // round(118 * 1.15)
    const planning = getPlanningCovers(mon.baseCovers, mon.autoConditions, null)!;
    expect(planning).toBe(136 + WALK_IN_COVERS); // +18 walk-ins
    expect(getBandForCovers(planning).band).toBe(5);
  });

  it('Wed rain: 82 → 74 → Band 2', () => {
    const wed = SAMPLE_DAYS.find((d) => d.id === '2026-09-16')!;
    const modified = applyModifiers(wed.baseCovers, wed.autoConditions)!;
    expect(modified).toBe(74); // round(82 * 0.9)
    const planning = getPlanningCovers(wed.baseCovers, wed.autoConditions, null)!;
    expect(planning).toBe(74 + WALK_IN_COVERS); // 92 → Band 3 with walk-ins
    expect(getBandForCovers(planning).band).toBe(3);
  });

  it('Sat no modifiers: 142 → Band 5', () => {
    const sat = SAMPLE_DAYS.find((d) => d.id === '2026-09-19')!;
    const planning = getPlanningCovers(sat.baseCovers, sat.autoConditions, null)!;
    expect(planning).toBe(142 + WALK_IN_COVERS);
    expect(getBandForCovers(planning).band).toBe(5);
  });
});

describe('auto modifier math', () => {
  it('locked percent constants', () => {
    expect(MODIFIER_PERCENTS.rainSnow).toBe(-0.1);
    expect(MODIFIER_PERCENTS.extremeTemp).toBe(-0.05);
    expect(MODIFIER_PERCENTS.radnorSchoolsClosed).toBe(0.1);
    expect(MODIFIER_PERCENTS.holiday).toBe(0.15);
  });

  it('rain/snow −10%', () => {
    const flags = { ...defaultConditions(), rainSnow: true };
    expect(applyModifiers(100, flags)).toBe(90);
  });

  it('extreme temp −5%', () => {
    const flags = { ...defaultConditions(), extremeTemp: true };
    expect(applyModifiers(100, flags)).toBe(95);
  });

  it('Radnor schools closed +10%', () => {
    const flags = { ...defaultConditions(), radnorSchoolsClosed: true };
    expect(applyModifiers(100, flags)).toBe(110);
  });

  it('holiday +15%', () => {
    const flags = { ...defaultConditions(), holiday: true };
    expect(applyModifiers(100, flags)).toBe(115);
  });

  it('school closed + rain stack', () => {
    const flags: DayConditions = {
      ...defaultConditions(),
      rainSnow: true,
      radnorSchoolsClosed: true,
    };
    expect(getModifierDelta(flags)).toBeCloseTo(0);
    expect(applyModifiers(100, flags)).toBe(100);
  });

  it('closed returns null', () => {
    expect(applyModifiers(142, { ...defaultConditions(), closed: true })).toBeNull();
  });

  it('manager override wins over auto modifiers + walk-ins', () => {
    const flags = { ...defaultConditions(), holiday: true };
    expect(WALK_IN_COVERS).toBe(18);
    expect(getPlanningCovers(118, flags, null)).toBe(136 + 18);
    expect(getPlanningCovers(118, flags, 120)).toBe(120);
  });

  it('active conditions strip lists detected items', () => {
    const flags = {
      ...defaultConditions(),
      holiday: true,
      rainSnow: true,
    };
    const chips = getActiveConditions(flags);
    expect(chips.map((c) => c.key)).toEqual(['rainSnow', 'holiday']);
  });
});

describe('cut priority (LOCKED)', () => {
  it('cut order is Host Asst → Extra Busser → Dish → Busser → 4th → 3rd', () => {
    expect([...CUT_PRIORITY_IDS]).toEqual([
      'hostAsst',
      'extraBusser',
      'dishSupport',
      'busser',
      'fourthServer',
      'thirdServer',
    ]);
  });

  it('Band 5 cuttable roles follow priority', () => {
    const roster = getBandForCovers(136).roster; // Band 5
    expect(getCuttableRoles(roster)).toEqual([
      'hostAsst',
      'extraBusser',
      'dishSupport',
      'busser',
      'fourthServer',
      'thirdServer',
    ]);
  });

  it('Band 3 has no host asst / extra busser / 4th server', () => {
    const roster = getBandForCovers(90).roster;
    expect(getCuttableRoles(roster)).toEqual([
      'dishSupport',
      'busser',
      'thirdServer',
    ]);
  });

  it('Band 1 has no cuttable roles (already skeleton)', () => {
    expect(getCuttableRoles(getBandForCovers(40).roster)).toEqual([]);
  });

  it('add order is reverse of cut priority', () => {
    const roster = getBandForCovers(136).roster;
    expect(getAddableRoles(roster)).toEqual([
      'thirdServer',
      'fourthServer',
      'busser',
      'dishSupport',
      'extraBusser',
      'hostAsst',
    ]);
  });

  it('role labels match product copy', () => {
    expect(CUT_ROLE_LABELS.hostAsst).toBe('Host Assistant');
    expect(CUT_ROLE_LABELS.dishSupport).toBe('Dish Support');
    expect(CUT_ROLE_LABELS.extraBusser).toBe('2nd Busser');
    expect(CUT_ROLE_LABELS.busser).toBe('Busser');
    expect(CUT_ROLE_LABELS.fourthServer).toBe('4th Server');
    expect(CUT_ROLE_LABELS.thirdServer).toBe('3rd Server');
  });
});

describe('3:30 skeleton floor', () => {
  it('15:30 is cut floor time', () => {
    expect(timeToMinutes('15:30')).toBe(15 * 60 + 30);
  });

  it('all standard cuts are safe before floor (leave ≥2s+1h)', () => {
    const roster = getBandForCovers(140).roster;
    for (const id of getCuttableRoles(roster)) {
      expect(isCutSafeBeforeFloor(id, roster)).toBe(true);
    }
  });

  it('pre-3:30 cuts never leave below 2 servers + 1 host', () => {
    const mon = getDefaultSample('2026-09-21');
    const planning = getPlanningCovers(mon.baseCovers, mon.autoConditions, null)!;
    const band = getBandForCovers(planning);
    const { cutPlan } = buildDayPlans(mon.curve, band.roster);
    const remaining = remainingAfterCuts(band.roster, cutPlan);
    expect(remaining.servers).toBeGreaterThanOrEqual(2);
    expect(remaining.host).toBeGreaterThanOrEqual(1);
  });

  it('cut plan never includes Host as a cut role', () => {
    const roster = getBandForCovers(140).roster;
    const { cutPlan } = buildDayPlans(SAMPLE_DAYS[0].curve, roster);
    expect(cutPlan.every((s) => s.roleLabel !== 'Host')).toBe(true);
    expect(cutPlan.every((s) => s.roleId !== ('host' as never))).toBe(true);
  });

  it('cuts at/after 3:30 are labeled MOD judgment', () => {
    const roster = getBandForCovers(140).roster;
    // Force decline only after 3:30
    const curve = [
      { time: '10:00', covers: 8 },
      { time: '12:00', covers: 40 },
      { time: '15:30', covers: 6 },
      { time: '16:00', covers: 4 },
      { time: '16:30', covers: 2 },
    ];
    const { cutPlan } = buildDayPlans(curve, roster);
    const late = cutPlan.filter((c) => timeToMinutes(c.time) >= timeToMinutes('15:30'));
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((c) => c.modJudgment)).toBe(true);
  });

  it('target servers uses ≤15 guests/server and skeleton floor', () => {
    expect(targetServersForWindow(0, 4)).toBe(2);
    expect(targetServersForWindow(30, 4)).toBe(2);
    expect(targetServersForWindow(31, 4)).toBe(3);
    expect(targetServersForWindow(60, 4)).toBe(4);
  });
});

describe('Add Plan + Cut Plan', () => {
  it('Band 5 day produces timed add and cut plans with exact roles', () => {
    const mon = getDefaultSample('2026-09-21');
    const planning = getPlanningCovers(mon.baseCovers, mon.autoConditions, null)!;
    const band = getBandForCovers(planning);
    expect(band.band).toBe(5);
    const { addPlan, cutPlan } = buildDayPlans(mon.curve, band.roster);

    expect(addPlan.length).toBe(6);
    expect(cutPlan.length).toBe(6);

    // First cut should be highest priority role present
    expect(cutPlan.map((c) => c.roleId)).toContain('hostAsst');
    expect(cutPlan[0].roleId).toBe('hostAsst'); // cut priority first among same-or-sorted

    // Actually cut plan is sorted by time then priority — first in priority list among cuts
    const byPriority = [...cutPlan].sort(
      (a, b) =>
        CUT_PRIORITY_IDS.indexOf(a.roleId) - CUT_PRIORITY_IDS.indexOf(b.roleId),
    );
    expect(byPriority[0].roleId).toBe('hostAsst');
    expect(byPriority[1].roleId).toBe('extraBusser');
    expect(byPriority[2].roleId).toBe('dishSupport');

    // Each step has a time + label
    for (const step of [...addPlan, ...cutPlan]) {
      expect(step.time).toMatch(/^\d{2}:\d{2}$/);
      expect(step.roleLabel.length).toBeGreaterThan(0);
    }
  });

  it('default sample is Mon Sep 21 (today in demo)', () => {
    expect(getDefaultSample().id).toBe('2026-09-21');
  });
});
