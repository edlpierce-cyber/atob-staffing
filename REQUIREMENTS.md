# ATOB FOH Staffing App — MVP Requirements

## Goal
Mobile web app for A Taste of Britain (Wayne, PA) managers. One app, two primary modes:

1. **Build** (ahead of week / ahead of service): enter **projected covers** (+ optional date via calendar picker) → **Build Schedule** roster by band for copying into 7Shifts. Add/Cut are not part of this mode.
2. **Run** (**today only** — calendar day when the manager opens the app): import Resy **Today's Spread** CSV (preferred) or **typed booked covers** (backup) → planning covers + curve → **Add Plan** and **Cut Plan**. Build Schedule still shows. No picker for other dates; Build handles future dates via Label/date + projected covers.

Manager does as little as possible — import or type today’s booked covers and plans are ready.

## Service model
- One all-day service: **10:00 AM – 5:00 PM** (no lunch/dinner split)
- Opening skeleton on floor at **10:00 AM**: 2 servers + 1 host
- Hard rule: **≤15 guests per server** (target 12)

## Cover-band grid (LOCKED)
| Band | Crew name | Covers | Servers | Busser | Host | Host Asst | Dish Support |
|------|-----------|--------|---------|--------|------|-----------|--------------|
| 1 | Skeleton Crew | ≤49 | 2 | 0 | 1 | 0 | 0 |
| 2 | Mid Service | 50–79 | 3 | 0 | 1 | 0 | 0 |
| 3 | Runner Crew | 80–109 | 3 | 1 | 1 | 0 | 1 |
| 4 | Full Floor | 110–129 | 4 | 1 | 1 | 1 | 1 |
| 5 | All Hands | 130+ | 4 | 2 | 1 | 1 | 1 |

## Modes

### Build
- Input: projected covers (number) treated as **base/projected covers**.
- Optional date via native calendar picker (`<input type="date">`); display label e.g. "Tue, Sep 30, 2026". Clearable.
- Planning math: `planning = base × auto modifiers + +18 walk-in cushion` (same formula as Run). Build defaults to **no auto conditions** unless later wired.
- Show Build Schedule roster (role counts + band) prominently.
- Hide Add/Cut (not the job of this mode).
- Hint: use this roster when writing the schedule in 7Shifts.

### Run
- Scope: **today only** (America/New_York calendar day). Heading shows Today + formatted date. No day picker for other dates.
- Preferred: Resy **Today's Spread** CSV (or Today overview ZIP / `current_booked_covers.csv`).
- Backup: typed booked covers → today-labeled day with a **flat/default curve** so Add/Cut still work.
- Empty state guides import or typed covers — not sample selection.
- Demo sample days may remain in a collapsed **Demo samples** disclosure for training only.
- When a day is loaded: show Conditions, Covers, Build Schedule, Add Plan, Cut Plan.

## Cover source
- **Run primary:** ResyOS CSV import **or** typed booked covers for **today’s** service (session labeled Today + today’s date).
- **Demo samples** (training only, collapsed in UI — not required for plans):
  - Sat Sep 19, 2026: 142 covers, strong all day
  - Wed Sep 16, 2026: 82 covers, noon peak + late secondary bump (rain demo)
  - Mon Sep 21, 2026: 118 covers, Jewish high holiday → planning 136 → Band 5 · All Hands
- **ResyOS import** (client-side): prefer **Today's Spread** CSV (covers by 15-min service time → real curve + base = sum of intervals). Fallback: Today overview **ZIP** / `current_booked_covers.csv` (synthesized flat curve). ZIP prefers Today's Spread over current_booked_covers when both exist. Never sum status-breakdown CSVs. Locked +18 walk-in cushion and auto modifiers still apply. Import loads today’s run data for the session.
- **Typed booked covers** (Run backup): number + Apply loads today’s run slot with a flat curve and default (none) conditions.

## Automatic modifiers (not toggles)
- Heavy rain/snow: −10%
- Extreme heat/cold: −5%
- Radnor Township schools closed: **+10%**
- Major US/PA holiday (open): **+15%**
- Jewish high holiday (open): **+15%**
- ATOB closed: show Closed, no staffing
- Read-only Conditions strip; optional manager override for planning covers

## Add / Cut plans
- Add Plan: time + role for onboarding extras after open (from cover curve)
- Cut Plan: time + exact role; cut priority LOCKED:
  1. Host Assistant  2. Dish Support  3. Extra Busser  4. Busser  5. 4th Server  6. 3rd Server
- Never cut below 2 servers + 1 host before **3:30 PM**
- After 3:30 PM: suggestions labeled **MOD judgment**
- Required host is not cut before 3:30

## Users
- All ATOB managers (no auth required for MVP demo)

## Tech
- Mobile-first web app (Vite + React + TypeScript)
- Big numbers, thumb-friendly, readable outdoors

## Out of scope for MVP
- Night-before Glance tab, weather/holiday auto wiring, 7Shifts write-back, live Resy/Toast API (CSV import + typed backup are the interim paths), native apps
