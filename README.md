# ATOB FOH Staffing App

Mobile-first web app for **A Taste of Britain** (Wayne, PA) managers. One app, two modes:

1. **Build** — ahead of the week / ahead of service: enter **projected covers** → **Build Schedule** roster for 7Shifts.
2. **Run** — **today only** (calendar day when the manager opens the app): import Resy **Today's Spread** (preferred) or type booked covers (backup) → planning covers + curve → **Add Plan** / **Cut Plan** (Build Schedule still shown). No day picker for other dates — Build handles future dates.

Shared everywhere: locked cover bands, **+18 walk-in cushion**, auto modifier math.

## Quick start

```bash
cd /workspace/atob-staffing-app
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`). Use phone width (~390px) or DevTools device mode.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | Vite dev server |
| `npm test` | Unit tests (Vitest) — bands, modifiers, cut priority, 3:30 floor, typed day |
| `npm run build` | Production TypeScript + Vite build |
| `npm run preview` | Preview the production build |

## Modes

### Build
1. Tap **Build** in the top segmented control.
2. Enter **projected covers** (treated as base). Optionally pick a **date** (native calendar on phones) — label shows as e.g. `Tue, Sep 30, 2026`.
3. App applies planning math: projected × auto modifiers (**none** by default) **+ 18** walk-in cushion → band → roster.
4. Copy the **Build Schedule** into 7Shifts. Add/Cut are hidden in this mode.

### Run
1. Tap **Run**. Heading shows **Today** plus today’s date (America/New_York, e.g. `Wed, Sep 23, 2026`).
2. Prefer **Import Today's Spread** (or Today ZIP). Empty state asks for import or typed covers — not sample days.
3. **Backup:** type booked covers → **Apply** (flat curve) when no CSV. Loaded day is always labeled **Today**.
4. Follow **Add Plan** / **Cut Plan**; Build Schedule still shows for today’s loaded data.
5. Optional collapsed **Demo samples** at the bottom are for training only.

## Import Resy CSV / ZIP

**Preferred:** Resy **Today's Spread** CSV — covers by 15-minute service-time interval (real reservation curve for Add/Cut plans). Drop the CSV (or a ZIP that contains it). The app sets **booked / base covers** to the sum of interval covers and builds a zero-filled 10:00–17:00 15-min curve.

**Fallback:** ResyOS **Reports → Today → Dashboard actions → Download** gives a **ZIP** (e.g. `dashboard-today_overview.zip`) with `current_booked_covers.csv` (header `Covers`, then the booked total — often duplicated). When no Today's Spread is present, the app uses that total and **synthesizes** a simple flat curve.

1. Prefer exporting / dropping **Today's Spread**; otherwise Download the Today overview ZIP or `current_booked_covers.csv`.
2. On the app (Run mode): tap **Import Resy CSV** or drop the file onto the import zone.
3. Today's Spread wins over `current_booked_covers` when both exist in a ZIP. Status-breakdown widgets (`today's_reservations_by_status.csv`) are never summed for staffing.
4. Import labels the day **Today · …** (calendar today) for this session.
5. Locked **+18 walk-in cushion** and auto modifiers still apply on top of imported booked covers.

**Typed backup:** if you cannot export, enter booked covers and tap **Apply**. Same imported slot, flat curve, +18 cushion.

**Note:** Reservations and Covers report pages may still be Email-only. MVP paths are Today's Spread, the Today overview ZIP / `current_booked_covers.csv`, and typed covers.

## Demo samples (training only)

Collapsed under **Demo samples** in Run — not the normal path. Managers use Today’s Spread or typed covers for **today**.

| Day | Base | Auto conditions | Planning | Band |
|-----|------|-----------------|----------|------|
| Sat Sep 19, 2026 | 142 | none | 160 | 5 · All Hands |
| Wed Sep 16, 2026 | 82 | rain −10% | 92 | 3 · Runner Crew |
| Mon Sep 21, 2026 | 118 | Jewish high holiday +15% | 154 | 5 · All Hands |

*(Planning = modified base + 18 walk-in cushion.)*

## Locked cover bands

| Band | Crew name | Covers | Roster |
|------|-----------|--------|--------|
| 1 | Skeleton Crew | ≤49 | 2s / 0b / 1h |
| 2 | Mid Service | 50–79 | 3s / 0b / 1h |
| 3 | Runner Crew | 80–109 | 3s / 1b / 1h / 1dish |
| 4 | Full Floor | 110–129 | 4s / 1b / 1h / 1asst / 1dish |
| 5 | All Hands | 130+ | 4s / 2b / 1h / 1asst / 1dish |

## Auto modifiers (locked %)

Applied from sample-day metadata (not primary toggles):

- Rain/snow **−10%**
- Extreme heat/cold **−5%**
- Radnor schools closed **+10%**
- Major US/PA holiday **+15%**
- Jewish high holiday **+15%**
- ATOB closed → no staffing

Percentages stack additively on **booked / base** covers → rounded, then **+18 walk-in cushion** → **planning covers** → band. Optional manager override replaces planning covers. Build mode uses the same formula with projected covers as base and default (none) conditions.

## Cut priority (LOCKED)

Cut higher-cost / support roles **before** servers:

1. Host Assistant  
2. Dish Support  
3. Extra Busser (2nd on Band 5)  
4. Busser  
5. 4th Server  
6. 3rd Server  

Never cut below **2 servers + 1 host** before **3:30 PM**. After 3:30, further suggestions are labeled **MOD judgment**. Required host is not cut before 3:30.

## Key files

- `src/App.tsx` — phone-first UI (Build | Run)
- `src/lib/staffing.ts` — bands + auto modifier math
- `src/lib/pacing.ts` — Add/Cut plans + cut priority + 3:30 floor
- `src/lib/samples.ts` — demo days + auto conditions + curves
- `src/lib/dates.ts` — today / Build date labels (America/New_York)
- `src/lib/resyCsv.ts` — ResyOS CSV/ZIP parse + typed booked-day helper
- `src/lib/staffing.test.ts` / `resyCsv.test.ts` — Vitest coverage
- `REQUIREMENTS.md` — product requirements

## Out of scope (MVP)

Night-before Glance, live Resy/Toast API (CSV + typed backup are interim), 7Shifts write-back, weather/holiday auto wiring, auth/PIN, native apps.
