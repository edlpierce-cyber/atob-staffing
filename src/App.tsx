import { useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  getActiveConditions,
  getBandForCovers,
  getPlanningCovers,
  WALK_IN_COVERS,
  netModifierPercent,
  rosterTotalHeads,
  defaultConditions,
  type DayConditions,
} from './lib/staffing';
import {
  SAMPLE_DAYS,
  scaleCurve,
  type SampleDay,
} from './lib/samples';
import { buildDayPlans, formatTime12 } from './lib/pacing';
import {
  importResyFile,
  toImportedSampleDay,
  createTypedBookedDay,
  ResyCsvError,
} from './lib/resyCsv';
import {
  formatBuildDateLabel,
  formatTodayLabel,
  formatRunTodayLabel,
} from './lib/dates';
import './App.css';

const ROLE_LABELS: Array<{
  key: keyof ReturnType<typeof getBandForCovers>['roster'];
  label: string;
}> = [
  { key: 'servers', label: 'Servers' },
  { key: 'busser', label: 'Busser' },
  { key: 'host', label: 'Host' },
  { key: 'hostAsst', label: 'Host Asst' },
  { key: 'dishSupport', label: 'Dish Support' },
];

export type AppMode = 'build' | 'run';

function RosterBlock({
  planningCovers,
  band,
  hint,
}: {
  planningCovers: number | null;
  band: ReturnType<typeof getBandForCovers> | null;
  hint: ReactNode;
}) {
  if (planningCovers === null || !band) {
    return (
      <div className="closed-banner" role="status">
        <strong>Closed</strong>
        <span>No staffing — ATOB closed today</span>
      </div>
    );
  }
  return (
    <>
      <div className="cover-summary">
        <div>
          <span className="muted">Band {band.band}</span>
          <strong className="crew-name">{band.crewName}</strong>
          <span className="band-range">{band.label} covers</span>
        </div>
        <div>
          <span className="muted">Heads</span>
          <strong className="big-num">{rosterTotalHeads(band.roster)}</strong>
        </div>
      </div>

      <ul className="roster-grid">
        {ROLE_LABELS.map((r) => {
          const n = band.roster[r.key];
          return (
            <li key={r.key} className={`role ${n === 0 ? 'zero' : ''}`}>
              <span className="role-count">{n}</span>
              <span className="role-name">{r.label}</span>
            </li>
          );
        })}
      </ul>
      <p className="skeleton-hint">{hint}</p>
    </>
  );
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('run');

  // --- Run mode: today only (import / typed / optional demo) ---
  /** Active Run day for this session; null until import, typed covers, or demo. */
  const [runDay, setRunDay] = useState<SampleDay | null>(null);
  /** Rare manual bump — empty string means no override */
  const [overrideInput, setOverrideInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [typedCoversInput, setTypedCoversInput] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);

  // --- Build mode state ---
  const [buildProjectedInput, setBuildProjectedInput] = useState('120');
  /** YYYY-MM-DD from native date input; empty = no label */
  const [buildDateIso, setBuildDateIso] = useState('');
  const buildLabel = formatBuildDateLabel(buildDateIso);

  const todayLabel = formatTodayLabel();
  const runTodayChip = formatRunTodayLabel();
  const hasRunDay = runDay !== null;

  const baseCovers = runDay?.baseCovers ?? 0;
  const conditions: DayConditions =
    runDay?.autoConditions ?? defaultConditions();
  const note = runDay?.note;

  const managerOverride =
    overrideInput.trim() === ''
      ? null
      : Math.max(0, Number.parseInt(overrideInput, 10) || 0);

  // Build: entered projected = base; default/none conditions; +18 cushion still applies
  const buildProjected = Math.max(
    0,
    Number.parseInt(buildProjectedInput, 10) || 0,
  );
  const buildConditions = defaultConditions();
  const buildPlanning = getPlanningCovers(
    buildProjected,
    buildConditions,
    null,
  );
  const buildBand =
    buildPlanning === null ? null : getBandForCovers(buildPlanning);

  // Run: planning only when a day is loaded
  const planningCovers = hasRunDay
    ? getPlanningCovers(baseCovers, conditions, managerOverride)
    : null;
  const band =
    planningCovers === null ? null : getBandForCovers(planningCovers);

  const activeChips = getActiveConditions(conditions);
  const netPct = netModifierPercent(conditions);

  const curve = useMemo(() => {
    if (!runDay) return [];
    const total =
      planningCovers && planningCovers > 0 ? planningCovers : baseCovers || 1;
    return scaleCurve(runDay.curve, total);
  }, [runDay, planningCovers, baseCovers]);

  const plans = useMemo(() => {
    if (!band || !hasRunDay) return { addPlan: [], cutPlan: [] };
    return buildDayPlans(curve, band.roster);
  }, [curve, band, hasRunDay]);

  function loadRunDay(day: SampleDay) {
    setRunDay(day);
    setOverrideInput('');
    setImportError(null);
    setTypedError(null);
  }

  async function handleImportFile(file: File) {
    setImportBusy(true);
    setImportError(null);
    setTypedError(null);
    try {
      const result = await importResyFile(file);
      const day = toImportedSampleDay(result);
      loadRunDay(day);
    } catch (err) {
      const msg =
        err instanceof ResyCsvError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not import Resy file.';
      setImportError(msg);
    } finally {
      setImportBusy(false);
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleImportFile(file);
    e.target.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleImportFile(file);
  }

  function applyTypedBooked() {
    setTypedError(null);
    setImportError(null);
    const n = Number.parseInt(typedCoversInput, 10);
    if (!Number.isFinite(n) || typedCoversInput.trim() === '') {
      setTypedError('Enter booked covers as a number.');
      return;
    }
    try {
      const day = createTypedBookedDay(n);
      loadRunDay(day);
    } catch (err) {
      setTypedError(
        err instanceof Error ? err.message : 'Could not apply typed covers.',
      );
    }
  }

  const deltaPct =
    planningCovers !== null && baseCovers > 0 && managerOverride === null
      ? Math.round(((planningCovers - baseCovers) / baseCovers) * 100)
      : managerOverride !== null && baseCovers > 0
        ? Math.round(((managerOverride - baseCovers) / baseCovers) * 100)
        : 0;

  return (
    <div className="app">
      <header className="header">
        <p className="eyebrow">A Taste of Britain · Wayne, PA</p>
        <h1>FOH Staffing</h1>
        <p className="sub">
          All-day 10:00 AM – 5:00 PM · Build ahead or Run the day
        </p>
      </header>

      <div
        className="mode-switch"
        role="tablist"
        aria-label="App mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'build'}
          className={`mode-btn ${mode === 'build' ? 'active' : ''}`}
          onClick={() => setMode('build')}
        >
          Build
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'run'}
          className={`mode-btn ${mode === 'run' ? 'active' : ''}`}
          onClick={() => setMode('run')}
        >
          Run
        </button>
      </div>

      {mode === 'build' ? (
        <>
          <section className="card">
            <h2>Projected covers</h2>
            <p className="mode-hint">
              Ahead of the week / ahead of service. Enter projected covers to
              get the Build Schedule roster for 7Shifts.
            </p>
            <label className="covers-label" htmlFor="build-projected">
              Projected covers (base)
            </label>
            <input
              id="build-projected"
              className="build-input"
              inputMode="numeric"
              pattern="[0-9]*"
              value={buildProjectedInput}
              onChange={(e) =>
                setBuildProjectedInput(e.target.value.replace(/[^\d]/g, ''))
              }
              aria-label="Projected covers"
            />
            <label className="covers-label" htmlFor="build-date">
              Label / date
            </label>
            <div className="build-date-row">
              <input
                id="build-date"
                className="build-date-input"
                type="date"
                value={buildDateIso}
                onChange={(e) => setBuildDateIso(e.target.value)}
                aria-label="Optional schedule date"
              />
              {buildDateIso && (
                <button
                  type="button"
                  className="build-date-clear"
                  onClick={() => setBuildDateIso('')}
                  aria-label="Clear date"
                >
                  Clear
                </button>
              )}
            </div>
            {buildLabel && <p className="note build-date-preview">{buildLabel}</p>}
          </section>

          <section className="card covers-card">
            <h2>Covers</h2>
            <div className="cover-stack">
              <div className="cover-row">
                <span className="muted">Projected / base</span>
                <strong>{buildProjected}</strong>
              </div>
              <div className="cover-row">
                <span className="muted">Walk-in cushion</span>
                <strong>+{WALK_IN_COVERS}</strong>
              </div>
              <div className="cover-row planning-row">
                <span className="muted">Planning covers</span>
                <strong className="big-num planning">
                  {buildPlanning === null ? '—' : buildPlanning}
                </strong>
              </div>
            </div>
            <p className="covers-hint">
              Planning = projected × auto modifiers (none by default) + walk-in
              cushion. Same math as Run mode.
            </p>
          </section>

          <section className="card roster-card">
            <h2>
              Build Schedule
              {buildLabel ? (
                <span className="build-schedule-label"> · {buildLabel}</span>
              ) : null}
            </h2>
            <RosterBlock
              planningCovers={buildPlanning}
              band={buildBand}
              hint="Use this roster when writing the schedule in 7Shifts."
            />
          </section>
        </>
      ) : (
        <>
          <section className="card">
            <h2>Today</h2>
            <p className="today-date" aria-live="polite">
              {todayLabel}
            </p>
            <p className="mode-hint">
              Run is for <strong>today&apos;s service only</strong>. Import
              Today&apos;s Spread or type booked covers — no other date picker.
            </p>

            {!hasRunDay && (
              <p className="run-empty-guide" role="status">
                Nothing loaded yet. Import <strong>Today&apos;s Spread</strong>{' '}
                (or Today Download ZIP) or type booked covers below to get
                planning covers and Add / Cut plans.
              </p>
            )}

            {hasRunDay && (
              <div className="run-loaded" role="status">
                <span className="run-loaded-chip">{runTodayChip}</span>
                <span className="run-loaded-covers">
                  {baseCovers} booked
                </span>
              </div>
            )}
            {note && hasRunDay && <p className="note">{note}</p>}

            <div
              className={`import-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
                className="import-input"
                aria-label="Import Resy Today's Spread or Today Download CSV or ZIP"
                onChange={onFileChange}
              />
              <button
                type="button"
                className="import-btn"
                disabled={importBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {importBusy ? 'Importing…' : "Import Today's Spread"}
              </button>
              <p className="import-hint">
                Prefer <strong>Today&apos;s Spread</strong> CSV (covers by 15-min
                service time) or Today Download ZIP / current_booked_covers.
                Booked covers drive staffing; +{WALK_IN_COVERS} walk-in cushion
                still applies.
              </p>
              {importError && (
                <p className="import-error" role="alert">
                  {importError}
                </p>
              )}
            </div>

            <div className="typed-backup">
              <h3 className="typed-heading">No CSV? Type booked covers</h3>
              <p className="import-hint typed-hint">
                Backup when Resy export isn&apos;t handy. Applies a flat curve so
                Add / Cut still work. Same +{WALK_IN_COVERS} cushion.
              </p>
              <div className="typed-row">
                <input
                  className="typed-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Booked covers"
                  value={typedCoversInput}
                  onChange={(e) =>
                    setTypedCoversInput(e.target.value.replace(/[^\d]/g, ''))
                  }
                  aria-label="Typed booked covers"
                />
                <button
                  type="button"
                  className="typed-apply"
                  onClick={applyTypedBooked}
                >
                  Apply
                </button>
              </div>
              {typedError && (
                <p className="import-error" role="alert">
                  {typedError}
                </p>
              )}
            </div>
          </section>

          {hasRunDay && (
            <>
              <section className="card conditions-card">
                <h2>Conditions</h2>
                {conditions.closed ? (
                  <p className="conditions-empty closed">
                    ATOB closed — no staffing
                  </p>
                ) : activeChips.length === 0 ? (
                  <p className="conditions-empty">No auto modifiers today</p>
                ) : (
                  <ul
                    className="conditions-strip"
                    aria-label="Auto-detected conditions"
                  >
                    {activeChips.map((c) => (
                      <li
                        key={c.key}
                        className={`condition-chip ${c.percent < 0 ? 'down' : 'up'}`}
                      >
                        <span className="chip-label">{c.label}</span>
                        <span className="chip-pct">{c.pctLabel}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {!conditions.closed && (
                  <p className="net-pct">
                    Net auto adjustment:{' '}
                    <strong>
                      {netPct > 0 ? '+' : ''}
                      {netPct}%
                    </strong>
                  </p>
                )}
              </section>

              <section className="card covers-card">
                <h2>Covers</h2>
                <div className="cover-stack">
                  <div className="cover-row">
                    <span className="muted">Booked / base (Resy)</span>
                    <strong>{baseCovers}</strong>
                  </div>
                  <div className="cover-row">
                    <span className="muted">Walk-in cushion</span>
                    <strong>+{WALK_IN_COVERS}</strong>
                  </div>
                  {deltaPct !== 0 && managerOverride === null && (
                    <div className="cover-row">
                      <span className="muted">Auto conditions</span>
                      <strong className={deltaPct > 0 ? 'up' : 'down'}>
                        {deltaPct > 0 ? '+' : ''}
                        {deltaPct}%
                      </strong>
                    </div>
                  )}
                  <div className="cover-row planning-row">
                    <span className="muted">Planning covers</span>
                    <strong className="big-num planning">
                      {planningCovers === null ? '—' : planningCovers}
                    </strong>
                  </div>
                </div>
                <p className="covers-hint">
                  Roster uses <strong>planning covers</strong> (base × auto
                  modifiers + walk-ins
                  {managerOverride !== null ? ', then your override' : ''}).
                </p>

                <details className="override-details">
                  <summary>Manager override (rare)</summary>
                  <label className="covers-label" htmlFor="override">
                    Override planning covers
                  </label>
                  <input
                    id="override"
                    className="override-input"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Leave blank to use auto"
                    value={overrideInput}
                    onChange={(e) =>
                      setOverrideInput(e.target.value.replace(/[^\d]/g, ''))
                    }
                    aria-label="Manager override planning covers"
                  />
                </details>
              </section>

              <section className="card roster-card">
                <h2>Build Schedule</h2>
                <RosterBlock
                  planningCovers={planningCovers}
                  band={band}
                  hint={
                    <>
                      Open 10:00 with <strong>2 servers + 1 host</strong>. Follow
                      Add Plan / Cut Plan below.
                    </>
                  }
                />
              </section>

              {band && (
                <>
                  <section className="card plan-card add-plan">
                    <h2>Add Plan</h2>
                    <p className="plan-rules">
                      Onboard extras after open from today&apos;s cover curve.
                    </p>
                    <div className="curve-bars" aria-hidden>
                      {curve.map((s) => {
                        const max = Math.max(...curve.map((c) => c.covers), 1);
                        return (
                          <div key={s.time} className="bar-col">
                            <div
                              className="bar"
                              style={{ height: `${(s.covers / max) * 56}px` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {plans.addPlan.length === 0 ? (
                      <p className="plan-empty">
                        No extras — open with skeleton only (Band {band.band} ·{' '}
                        {band.crewName}).
                      </p>
                    ) : (
                      <ol className="plan-list">
                        {plans.addPlan.map((step) => (
                          <li key={`add-${step.roleId}`} className="plan-step add">
                            <time>{formatTime12(step.time)}</time>
                            <span className="plan-action">
                              Add {step.roleLabel}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>

                  <section className="card plan-card cut-plan">
                    <h2>Cut Plan</h2>
                    <p className="plan-rules">
                      Cut support / higher-cost roles before servers. Never below{' '}
                      <strong>2 servers + 1 host</strong> before{' '}
                      <strong>3:30 PM</strong>. After 3:30 →{' '}
                      <strong>MOD judgment</strong>.
                    </p>
                    {plans.cutPlan.length === 0 ? (
                      <p className="plan-empty">No cuts — already at skeleton.</p>
                    ) : (
                      <ol className="plan-list">
                        {plans.cutPlan.map((step) => (
                          <li
                            key={`cut-${step.roleId}`}
                            className={`plan-step cut ${step.modJudgment ? 'mod' : ''}`}
                          >
                            <time>{formatTime12(step.time)}</time>
                            <span className="plan-action">
                              Cut {step.roleLabel}
                            </span>
                            {step.modJudgment && (
                              <span className="mod-badge">MOD judgment</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </>
              )}
            </>
          )}

          <details className="demo-samples card">
            <summary>Demo samples</summary>
            <p className="import-hint">
              Training only — loads a sample curve for practice. Normal Run uses
              Today&apos;s Spread or typed covers for <strong>today</strong>.
            </p>
            <div className="sample-row" role="group" aria-label="Demo sample days">
              {SAMPLE_DAYS.map((day) => (
                <button
                  key={day.id}
                  type="button"
                  className={`sample-btn ${runDay?.id === day.id ? 'active' : ''}`}
                  onClick={() => loadRunDay(day)}
                >
                  <span className="sample-day">{day.label}</span>
                  <span className="sample-covers">{day.baseCovers}</span>
                </button>
              ))}
            </div>
          </details>
        </>
      )}

      <footer className="footer">
        MVP · Build / Run · Auto conditions · Resy CSV + typed backup · Locked
        cut priority
      </footer>
    </div>
  );
}
