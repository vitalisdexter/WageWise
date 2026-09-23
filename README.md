# WageWise

A personal wage calculator and payroll tracker Progressive Web App (PWA) built for a Material Scheduler based in Scotland. Replaces a spreadsheet-based system for tracking weekly pay.

## Project Overview

- **Name:** WageWise
- **Owner:** A Material Scheduler in Scotland
- **Purpose:** Personal wage calculator and payroll tracker — single user, local data only
- **Platform:** Mobile-first Progressive Web App (PWA), designed primarily for phone use
- **Persistence:** Browser-based local storage, no server or database required
- **Pay cycle modeled:** Weekly pay with fixed basic pay + variable overtime at multiple rates (including overnight shifts), taxed under real HMRC Scottish Income Tax rules with cumulative PAYE, plus UK National Insurance

## Architecture

- **Multi-screen app** with bottom navigation, five tabs:
  1. **Calculator** — enter a week's hours/OT, see net pay
  2. **Dashboard** — monthly bar charts, YTD stats, forecasting
  3. **Calendar** — monthly/weekly views with OT and entry markers
  4. **Payslip** — formatted payslip view with print/PDF export
  5. **Settings** — basic pay constant, employer/employee names, deduction presets

- **Client-side only.** No backend calls, no API keys, no external services required.
- Built for mobile screens first; layout remains usable at small viewport widths.

## Data Model

### Settings (persistent, single record)

- **Basic pay** (weekly constant, defaults from Settings)
- **Employer name**, **employee name** (for payslip header)
- **Tax code:** `S1257L` (Scottish, standard personal allowance)
- **Deduction presets:** Named groups of custom deductions that can be applied in one tap (e.g. "Union dues", "Pension") — each preset is a set of named deduction amounts

### Earnings entry (one per pay week, stored in history)

- **Date / tax week number**
- **Basic pay** for that week
- One or more **overtime entries**, each with:
  - **Rate** (e.g. time-and-a-half, double time, or a custom rate)
  - **Hours** — enterable as a manual hour count **or** as a shift start/end time (with support for overnight shifts that cross midnight)
- **Deductions applied** (from presets or ad hoc)
- **Computed:** gross pay, tax deducted, NI deducted, net pay
- **Editable and deletable** after saving

### YTD cumulative state

- **Cumulative taxable pay** and **cumulative tax paid** to date, needed by the PAYE engine
- Derived from the saved earnings history in tax-week order, **not** stored as a separate hand-maintained counter, so edits/deletes to past entries stay consistent

## Payroll Domain Logic (critical — read carefully)

### Scottish Income Tax — cumulative PAYE

The correct method, mirroring what HMRC actually does:

1. **Track the tax week number** (week 1 = first week of the tax year, which starts 6 April).
2. At each pay week, compute **cumulative taxable pay** = cumulative gross pay to date minus cumulative personal allowance to date (personal allowance ÷ 52 × tax week number).
3. Apply the **cumulative** progressive tax bands to that cumulative taxable pay to get cumulative tax due.
4. Subtract tax already paid in previous weeks (cumulative) to get **this week's tax deduction**.
5. This correctly smooths out high-overtime weeks — a single big week doesn't get taxed as if the employee earns that much every week.

**Do not annualise a single week's gross pay** (e.g. gross × 52) and tax that in isolation to determine the band. This was the original bug.

### Scottish Income Tax bands — 2026/27 tax year (verify current year before relying on this)

Tax code assumed: `S1257L` (standard Personal Allowance, no adjustments).

| Band | Rate | Taxable income (above £12,570 Personal Allowance) |
|---|---|---|
| Personal Allowance | 0% | up to £12,570 |
| Starter rate | 19% | £12,571 – £16,537 |
| Basic rate | 20% | £16,538 – £29,526 |
| Intermediate rate | 21% | £29,527 – £43,662 |
| Higher rate | 42% | £43,663 – £75,000 |
| Advanced rate | 45% | £75,001 – £125,140 |
| Top rate | 48% | above £125,140 |

Notes:
- These are **income tax bands only** — Scotland sets its own bands/rates; National Insurance is UK-wide and unaffected by Scottish rates.
- Personal Allowance tapers away £1 for every £2 earned over £100,000 (fully gone at £125,140).
- **Scottish tax bands and thresholds change every tax year (each April), sometimes mid-cycle via Budget announcements.** Treat these numbers as needing a fresh check at least annually, ideally at app startup or as a configurable table rather than hardcoded magic numbers.

### National Insurance — 2026/27 (Class 1, standard Category A, UK-wide)

| Threshold | Weekly | Annual |
|---|---|---|
| Primary Threshold (NI-free up to here) | £242 | £12,570 |
| Upper Earnings Limit | £967 | £50,270 |

- 0% below the Primary Threshold
- 8% on earnings between Primary Threshold and Upper Earnings Limit
- 2% on earnings above the Upper Earnings Limit
- **NI is calculated per pay period, not cumulatively** — unlike income tax, each week stands alone for NI purposes. Do not apply the cumulative logic from §4.1 to NI.

### Overtime

- Multiple overtime entries per week, each potentially at a different rate (e.g. 1.5×, 2×, or a custom multiplier/rate).
- Hours can be entered either as a raw number or derived from a shift start/end time, including shifts that span midnight (overnight shifts) — the duration calculation must handle the day rollover correctly.

## Key Learnings & History

- **The core bug that was found and fixed:** the app originally annualised each week's gross pay in isolation to determine which tax band applied. This meant a week with heavy overtime looked, in isolation, like an annual salary far above what the person actually earns, which falsely pushed that week into the Scottish higher-rate band and overstated the tax deducted.
- **The fix:** implement the cumulative PAYE engine described above, using tax week number and year-to-date history, which is what HMRC actually does.
- **Validation method:** the fix was validated by comparing WageWise's output against the user's real payslips. If you make further changes to the tax engine, the most reliable way to sanity-check them is to compare against a real payslip figure for a given week and compare gross/tax/NI/net line by line, rather than trusting the math in isolation.

## Feature Summary by Screen

### Calculator

- Enter basic pay (defaults from Settings) + one or more OT entries (rate + hours or shift times) + any deductions → shows computed gross, tax, NI, net
- Save to history
- **YTD Override (Payslip Input):** Collapsible drawer to enter YTD Gross, Tax, NI, and Tax Week from your latest payslip. Overrides history-derived cumulative figures so the calculator matches your real PAYE position.
- **Overtime Sweet Spot Calculator:** Enter an hourly OT rate → see a table of extra hours vs. keep-rate. Shows exactly where your keep-rate steps down (crossing Scottish tax bands) or up (clearing NI UEL).
- **YTD Summary Line:** "Year to date: gross X · tax Y · NI Z" displayed below net pay
- **Tax Week Label:** Ledger shows "Tax · Week N" instead of "Tax · N bands"
- **Cumulative Breakdown Table:** Tax breakdown shows "YTD amount" / "YTD tax" columns

### Dashboard

- Monthly bar charts of pay
- Year-to-date stats (gross/tax/NI/net)
- Forward forecasting based on patterns in the saved history

### Calendar

- Monthly and weekly views with visual markers on days/weeks that have overtime or saved entries
- Print monthly payslip

### Payslip

- Professional-looking payslip layout — employer name, employee name, tax week, full breakdown of pay/deductions
- Print and PDF export
- **YTD Totals Section:** Both print and screen versions show "To-date totals (tax year...)" with YTD Gross, Tax, Employee NI
- Tax breakdown rows show "Cumulative YTD" amounts per band

### Settings

- **Basic pay** (persistent constant used as calculator default)
- **Employer/employee name** fields
- **Management of deduction presets** (create/edit/delete named groups of deductions, apply in one tap on the Calculator)
- **Recalculate History Button:** One-click re-run of the cumulative engine on all saved entries. Adjusts net pay by exactly the tax correction. Safe to run anytime after tax engine updates.
- Tax engine information display (with note about cumulative PAYE)
- Data: all data stored locally on this device only
- PWA: install app to home screen

## Working Style Expectations

- **Direct and concise.** Structured, sequential feature requests in plain language, implemented correctly without a lot of back-and-forth.
- **Deliver working code promptly**, with only a brief summary of what changed — not lengthy explanations unless asked.
- **Real payslips are the source of truth** for anything tax-related. If a real payslip is provided, treat its numbers as the target to match exactly.

## Suggested First Response

When this prompt is first given to a new AI (with or without the actual code attached), it should:

1. Confirm its understanding of the app's current state and the tax/NI logic above.
2. If files were attached: read them and report back what it finds, flagging any discrepancy with this spec.
3. If no files were attached: ask whether the user wants a full rebuild now, or wants to describe the next feature/fix first.
4. Not start writing large amounts of code before that confirmation.

## Technical Notes

- **Tax engine:** Scottish cumulative PAYE using tax week number (starting 6 April) and YTD history from saved earnings, with optional YTD override from payslip
- **NI engine:** Per-period calculation using UK Class 1 thresholds (Primary Threshold £242/week, Upper Earnings Limit £967/week)
- **Overtime:** Multiple entries per week, each with a rate; hours entered manually or via shift start/end times (including overnight/midnight-crossing shifts)
- **Persistence:** All data in `window.localStorage` under key `wagewise-v5`
- **PWA:** Can be installed to home screen; icons and manifest included
- **Theme:** Light/dark toggle, accent colour picker (pine, indigo, plum, slate)
- **Print:** Optimized for printing payslips with proper formatting

## Sweet Spot Engine Details

The Overtime Sweet Spot calculator analyses where your marginal keep-rate changes:

- **Tax band crossings:** Uses scaled bands (band width × tax week / 52) to find where extra OT hours push you into the next Scottish rate
- **NI thresholds:** Detects crossing of Primary Threshold (£242/week) and Upper Earnings Limit (£967/week)
- **Blended rate:** Averages your current OT rates for modelling, or uses the last entered rate
- **Output:** Table of hour ranges with keep-rate (p/£1), tax band, and NI regime

## Recalculate History

The "Recalculate tax on saved history" button in Settings → Tax engine:
- Re-runs the cumulative engine on all non-manual history entries in date order
- For each entry: computes correct tax using current engine, compares to stored tax
- Adjusts net pay by exactly the tax difference (preserves any custom deductions baked into net)
- Use after tax engine updates or if you suspect drift between saved entries and current logic

## File Structure

```
wagewise/
├── wagewise.html    (main application — ~1760 lines)
├── package-lock.json
├── index.html       (deployed version on Cloudflare)
└── README.md        (this file)
```

## Deployment

- **No backend required** — pure client-side PWA
- All data persists in browser `localStorage`
- Can be hosted on any static file host (Netlify, Vercel, Cloudflare Pages, etc.)
- For PWA features (install to home screen), ensure HTTPS and proper manifest/service worker
- Open `wagewise.html` with `live-server` or similar for local development (required for service worker registration)