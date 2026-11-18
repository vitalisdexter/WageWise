# WageWise for Android

WageWise for Android includes an overtime log, local working-day reminders, weekly payslip comparisons, and the existing Scottish PAYE calculator. Android 8 or newer is required.

## Install and set up

1. Copy the signed `WageWise-2.0.0.apk` to your phone and open it in Files. Follow Android's installation prompt. For an existing install, select **Update**.
2. In **Settings**, enable the working-day reminder and allow notifications. The proposed schedule is Monday to Friday at 7 pm in your phone's timezone. Android can delay delivery under battery restrictions.
3. Set a known overtime cutoff and the corresponding pay date. The cutoff is the final work date on that payslip, and both dates repeat weekly. An overnight shift belongs to the date it started.
4. Use **Calendar** to record overtime, zero overtime or a day off. Calculator includes the logged shifts for its selected payday. Dashboard shows logged overtime and pay history.
5. **Payslip** opens the original preview. Use **Check against my log** to compare with your employer's figures. Enter the latest payslip totals here for cumulative estimates.
6. In **Settings → Device pairing and sync**, create a private pairing code or paste the code from a paired browser.

Open **Settings → Backups** to save and restore your data. A website backup imports calculator settings and saved pay history while keeping the Android log. An Android backup restores both. These files can contain personal financial information.

## Planner

- **Forecast** uses the weekly cutoff in Settings. For cumulative estimates, enter the taxable pay and tax paid to date as printed on the latest payslip. Planned overtime is a total per work date. The forecast includes the balance until you finish logging that date or reconcile the corresponding payslip.
- **Net-pay goal** uses the logged and planned estimate for the chosen payday. Enter your available extra hours in quarter-hour steps. Assign any suggested hours to eligible work dates and confirm to include them in the forecast.
- **Payday pots** can use a forecast or actual take-home pay. Monthly bills are converted to weekly reserves. Enter your own contributions, returns, and fees for investment scenarios. The figures show how those assumptions affect the projected balance.

Android backups from 1.1 include the planner. Restoring a 1.0 backup starts the planner empty. Importing a website backup keeps the Android log and planner.

## Build and sign

Use Node.js 22+, JDK 21, Android SDK 36 and build-tools 36.0.0. The Gradle wrapper fetches the project’s Gradle version. From the repository root on Windows:

```powershell
npm ci
npm ci --prefix mobile
npm run check
pwsh -File mobile/release.ps1 -VersionCode 5 -VersionName 2.0.0
```

The script packages the shared web build, tests the Android scheduler, and signs the APK under `mobile/releases/`. It can use the workspace-local toolchain or `JAVA_HOME` and `ANDROID_HOME`. On the first successful build it creates `.android-signing/wagewise-release.p12` and protects its password with Windows DPAPI for the current user. Keep both signing files private and preserve access to the Windows account that created them. To move the build to another machine, first arrange a secure transfer and recovery of the original signing credentials.

Use increasing `-VersionCode` values for updates. Keep the app ID `uk.co.wagewise.mobile` and reuse the original signing certificate. The website and Cloudflare build use the repository root and its existing `public/` directory.

## Android release checks

- Install the signed build. In airplane mode, log a timed overnight shift and a second duration on the same day. Reopen the app and verify both entries and amounts.
- Set a near-future reminder for today. Check the permission-denied state, enable notifications, then leave the app and lock the screen. Tap the notification and confirm the selected work date. Repeat with a completed date to confirm suppression. Verify scheduling after reboot.
- Export the log and restore first a website backup, then an Android backup. Check both preview counts and the restored records. Install a build with a higher version code and the same certificate over the first build and confirm the records and schedule are still present.
