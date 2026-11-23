# WageWise

WageWise combines a weekly Scottish pay calculator, overtime calendar, payslip
checks and financial planner. Install it from
https://wagewise.vitalisdexter.workers.dev/ using **Install app** in Android
Chrome. The home-screen app picks up future web releases when opened online.

In **Settings → Workdays and reminders**, choose your working days and time,
enable reminders and allow browser notifications. The test button sends a push
immediately. A daily reminder opens the relevant work date in Calendar.

## Calculation scope

Supports weekly Scottish numeric suffix-code allowances (default S1257L), employee
NI category A, and tax years 2025/26 and 2026/27. It is an estimate, not certified
payroll software. Student loans, other tax-code types, other NI categories,
directors' NI, benefits in kind, salary sacrifice and pre-tax pension relief are
not supported. Custom deductions are taken **after tax and NI**.

Select the actual pay date. To use cumulative PAYE, enable the YTD override and
supply complete taxable gross and tax paid **before** this payment, plus the prior
tax week (current week minus one). Prior NI is optional and affects only the NI
YTD display. The figures must be from the same tax year. When reproducing a
payslip, subtract this period's figures from its printed YTD totals.

Without complete prior totals, WageWise explicitly uses a Week 1 estimate. It
does not assume a partial saved history is a complete payroll record. Week 53
uses Week 1 allowances. Refunds and the 50% regulatory deduction limit are
supported. HMRC handles allowance taper through the issued tax code; this is not
an annual self-assessment/taper estimator. Enter the allowance corresponding to
the actual numeric suffix code, not an assumed annual allowance.

The PAYE implementation uses HMRC code-number chunking, weekly free-pay rounding,
whole-pound taxable-pay rounding, four-decimal thresholds and downward penny
rounding. NI is weekly, not cumulative.

References:
- [HMRC PAYE technical specifications](https://www.gov.uk/government/publications/payroll-technical-specifications-income-tax)
- [PAYE routines v24, February 2026](https://assets.publishing.service.gov.uk/media/698c9824bd090be481c2879a/PAYErout-v24-0.odt), sections 3.3, 4, 8, 14 and Appendix B
- [Employer rates and thresholds 2026/27](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027)

## Data and history

WageWise requires an online account session to open records. A device keeps an
account-specific IndexedDB cache for sync. Version 2 imports the
existing browser data under `wagewise-v5` and the Android installation's private
store. Calendar is the work log, and Dashboard shows logged overtime alongside
saved pay entries. Set a known weekly cutoff in Settings to link the log to
Calculator, Payslip and Planner.

New calculated entries save their calculation, prior totals, allowance and
deductions. Displaying/printing history uses recorded amounts instead of silently
recalculating with today's settings. Old entries are retained as-is, not migrated
into supposedly accurate records. Manual and legacy entries are read-only apart
from deletion; add a corrected replacement when needed.

Choose **Create account**, select an available username and set a password.
To keep a paired workspace, choose **Use this paired device** or enter its
previous pairing code during account setup. Review the counts and confirm.
People with device-only records can start a workspace and review **Move my
local records** in Settings on the original browser. Sign in with the same
username on other devices. Original uploaded payslip files stay on the device
where they were saved. Settings also supports JSON backups.

**Forgot password** adds a request to the administrator's recovery inbox.
After verifying the account holder privately, the administrator issues a
single-use code, valid for 30 minutes. Approval closes existing sessions.
Choose **I have a reset code** to set a new password and sign back in.

The Worker uses the Supabase project in `supabase/client.json`, the database
functions in `supabase/migrations/` and the `WAGEWISE_SUPABASE_SECRET`
Worker secret. Account cookies are HttpOnly and each workspace has its own
sync revision. To enable the administrator, sign in to the Supabase CLI
on the owner's computer and run `.\scripts\provision-admin.ps1` in PowerShell.
The script prompts privately for the password. Open `/admin` to review
registrations, activity, sign-ins and password recovery.

## Development and checks

Requires Node.js 22+.

```sh
npm ci
npm test
npm run build
npm run check
```

- `wagewise.html` is the shared UI, `app/` contains browser modules and styles, and `payroll.js` is the calculation engine.
- `scripts/build.js` produces identical `index.html` and `public/index.html` and bundles the account screen.
- `public/` is the **only** Cloudflare asset directory.
- `public/sw.js` caches the app shell and payslip-reader assets, using
  network-first HTML requests. Keep its cache version current for asset changes.
- `tests/` contains synthetic payroll and app regression tests.
- Private payslip fixtures/images stay in ignored `payslips/` and must never be
  committed or copied to `public/`. Local verification, if fixtures are present:
  `node --test payslips/regression.test.js`.

The October 2026 audit reproduced all six supplied payslips' tax, NI and net pay
to the penny using complete prior YTD totals. This is regression evidence, not a
guarantee for unmodelled payroll arrangements. Additional tests cover refunds,
thresholds, date boundaries, invalid inputs, persistence, snapshots and escaping.

## Deployment

Web reminders use the existing Worker with a five-minute Cron Trigger and the
`wagewise-reminders` D1 database. Apply D1 migrations with
`npx wrangler d1 migrations apply REMINDERS --remote` and set the
`VAPID_PRIVATE_KEY` Worker secret to the private key matching the public key in
Wrangler configuration. Keep this key pair stable across deployments.

The existing Cloudflare **Worker** `wagewise` is connected to GitHub
`vitalisdexter/WageWise`, production branch `master`. Keep that Worker to retain
the existing workers.dev address and browser-local history.

Deploy command: `npx wrangler deploy`.
Wrangler's configured custom build runs tests and regenerates public assets.
Only public assets are uploaded. No payslips or local backups belong in the build.

Before pushing:
1. Run tests and regenerate assets.
2. Verify `npm run check` and `git diff --check`.
3. Review staged paths, especially for private data.
4. Push to the connected branch and verify Cloudflare reports a successful build.
5. Compare the live HTML with the generated file and smoke-test interactions.

## Audit fixes (October 2026)

- Removed divergent deployed HTML and obsolete tax engines.
- Replaced incorrectly scaled YTD totals and approximate payroll rounding.
- Added explicit pay-date/year selection, valid-zero YTD, refunds and Week 53.
- Preserved history and its original deductions; removed destructive bulk recalculation.
- Fixed cumulative tax being presented as this week's payslip deductions.
- Corrected dashboard tax-year boundaries and empty-overtime reload behaviour.
- Escaped names, notes and deduction labels in HTML output.
- Replaced unsupported blob service-worker registration with real hosted assets.
