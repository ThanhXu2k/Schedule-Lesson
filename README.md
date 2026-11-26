# Teaching Scheduler

A single-teacher scheduling application built with Google Apps Script, Google Sheets, and Google Calendar. Configure recurring student lessons, preview the following week, and create one private Calendar event with one student attendee per lesson. Google Calendar requests a separate Google Meet conference for each lesson.

The application starts in **development mock mode**. It does not create real events, send invitations, or install weekly automation until the teacher explicitly enables those operations. No Google account was connected during development; live Google behavior must be verified in your account before you rely on automation.

## Run locally

Install Node.js 20 or later, then run these commands from this project directory:

```powershell
npm run build
npm test
npm run check
npm start
```

Open [the local application](http://127.0.0.1:4173). No `npm install` is needed: the project has no third-party runtime or build dependencies. The server binds to the local computer only. Stop it with Ctrl+C.

Local development stores records in the browser. Mock Calendar operations remain local, invitations are simulated, and Google Meet links are unavailable. Local automation does not continue when the browser or computer is off. Use the Google Apps Script deployment for unattended scheduling.

## What is included

- Student profiles with active, paused, and inactive statuses.
- Multiple recurring weekly slots per student, effective dates, interval weeks, and schedule pause/resume.
- Dashboard, schedule views, lesson history, attendance, notes, automation logs, settings, and exports.
- One-time lessons, individual rescheduling, cancellations, and manual weekly generation with preview.
- Calendar availability checks, attendee isolation, conference creation, reconciliation, and safe retries.
- Separate lesson, synchronization, conference, invitation-request, and attendee-response statuses.
- Light, dark, and system appearance.

Payments, prepaid packages, student self-booking, and multiple teachers are deferred.

## Architecture

| Part | Files | Responsibility |
| --- | --- | --- |
| Domain engine | `src/core.js` | Validation, recurrence, timezone conversion, conflict checks, lesson lifecycle, and automation |
| Interface | `src/index.html`, `src/styles.css`, `src/app.js` | Browser interface and transport |
| Google backend | `gas/Code.gs` | Owner authorization, RPC, Sheets persistence, Calendar adapter, quotas, and triggers |
| Manifest | `gas/appsscript.json` | Advanced Calendar service, OAuth scopes, and owner-only deployment |
| Build | `scripts/build.mjs` | Generates a standalone browser application and Apps Script upload files |
| Local server | `scripts/serve.mjs` | Serves the development application over loopback |

The browser and Apps Script use the same scheduling engine. Google access is injected through an adapter; no credentials or OAuth tokens are embedded in browser code. Apps Script uses Google's account authorization rather than a separately maintained server.

`dist/index.html` is the local build. `apps-script/` contains generated deployment files. Edit `src/` and `gas/`, then rebuild; edits made only to generated files will be overwritten.

## Deploy to your Google account

### 1. Create the private database and script

1. Create a Google Sheet that only you can access.
2. In that Sheet, select **Extensions → Apps Script**.
3. Run `npm run build` locally.
4. Replace the editor's default code with `apps-script/Code.gs`.
5. Add a Script file named `Core` and paste `apps-script/Core.gs`.
6. Add an HTML file named `Index` and paste `apps-script/Index.html`.
7. In **Project Settings**, enable **Show "appsscript.json" manifest file in editor**. Replace the manifest with `apps-script/appsscript.json`.
8. Confirm that the project uses the V8 runtime.

Do not upload the application to a public static host as a substitute for Apps Script. The local version is a development environment; its browser storage is not the production Sheets database.

### 2. Enable Calendar and authorize

The manifest enables the Advanced Calendar service, version 3. Confirm it appears under **Services** in the editor. If it is absent, add **Google Calendar API** there.

For the default Cloud project created by Apps Script, adding the advanced service enables the corresponding API automatically. If you attach a standard Cloud project, enable the Google Calendar API in that project yourself. Keep the project in Google's no-cost **Standard Tier**, with no billing account or paid quota enrollment. This application never provisions infrastructure, enrolls in a paid tier, or raises quotas.

Run `setup` from the Apps Script editor and authorize the requested permissions. It records the signed-in account as `OWNER_EMAIL`, records the database's `SPREADSHEET_ID`, creates the five application sheets, and initializes settings. A standalone script can also run setup; it creates a spreadsheet if none is active.

`setup` does not enable live Calendar writes or create triggers. Re-running it preserves existing records. Teacher name/email in application settings are profile fields; changing them does not transfer database ownership.

See [Google's advanced-services setup instructions](https://developers.google.com/apps-script/guides/services/advanced).

### 3. Deploy an owner-only web app

1. Select **Deploy → New deployment → Web app**.
2. Set **Execute as** to **User accessing the web app**.
3. Set **Who has access** to **Only myself**.
4. Deploy, complete account authorization, and open the resulting URL while signed in as the owner.

The manifest declares `USER_ACCESSING` and `MYSELF`. Preserve both settings. Server requests also check the active account against the configured owner and reject missing identities. Do not work around identity errors by opening access to everyone or removing the owner check.

After source changes, rebuild, replace the generated files in the editor, and update the existing deployment to a new version. See [Google's web app deployment documentation](https://developers.google.com/apps-script/guides/web).

### 4. Connect Calendar safely

In **Settings**, configure the teaching calendar, conflict calendars, timezone, and reminders. Test the connection before enabling writes. The test checks calendar write access, Google Meet support, and availability access. It does not send invitations.

Use a dedicated private teaching calendar when possible. A calendar must allow the `hangoutsMeet` conference solution. Account or organization restrictions can prevent conference creation even when calendar access works; the application reports the failure and preserves the lesson record.

Before enabling live operations, export and clear development lessons and logs using the development-data control. Keep the student profiles and recurring schedules you want to use. Development lessons cannot be converted into real Google events by retrying them.

Enable live operations only after confirming that your project uses the no-cost tier with billing disabled. The application requires your explicit confirmation; it cannot independently inspect your Cloud billing enrollment. Start with one test student email that you control, create one future lesson, and check the event, attendee, Meet link, and cancellation before bulk generation.

### 5. Preview and activate weekly automation

1. Add active students and their recurring weekly slots.
2. Preview the upcoming week. Review eligible lessons, duplicates, conflicts, and invalid local times.
3. Confirm generation. In live mode this creates real Calendar events and requests student notifications.
4. Review the lesson states and automation log. Refresh synchronization to retrieve pending Meet results.
5. In Settings, explicitly enable weekly automation when the results are correct.

The defaults are Sunday, the 18:00 execution hour, and `Asia/Ho_Chi_Minh`. The next Monday through Sunday is generated by default. Settings support another weekday, execution hour, timezone, and one to four weeks of generation.

Apps Script selects an execution time within an hour window; 18:00 is a preferred hour, not an exact-minute guarantee. Triggers run on Google's servers under the account that created them, including when your computer is off. Enabling automation installs the weekly generation trigger and an hourly `conferenceReconciliation` trigger that reads up to 25 upcoming pending conferences per run. It does not generate additional events. Disable automation before changing its configuration, save the settings, then enable it again. Only this application's two trigger handlers are removed by its disable control.

See [installable time-driven triggers](https://developers.google.com/apps-script/guides/triggers/installable).

## OAuth permissions

| Scope suffix | Why it is required |
| --- | --- |
| `spreadsheets` | Open the private database by ID, create its sheets, and persist records |
| `calendar.events` | Read, create, patch, and cancel teaching events; inspect teaching-calendar conflicts |
| `calendar.calendarlist.readonly` | Offer the calendars available to the teacher and inspect access roles |
| `calendar.calendars.readonly` | Check selected-calendar metadata and supported conference solutions |
| `calendar.events.freebusy` | Check busy periods in additional conflict calendars |
| `script.scriptapp` | Install and remove the application's weekly trigger |
| `userinfo.email` | Restrict access to the authorized teacher |

Scopes are prefixed with `https://www.googleapis.com/auth/`. There is no Gmail, MailApp, Drive, or full-calendar-administration permission. Spreadsheet scope is broader than a single document because the web app opens its stored database ID and setup supports a standalone script; do not grant script editor access to other people.

Google may display an unverified-app notice for a personal unpublished script. Confirm that the script and Cloud project are your own before continuing. If authorization is revoked or scopes change, reauthorize from the editor. Unattended triggers cannot display an authorization prompt.

## Data model and storage

Setup creates `Students`, `RecurringSchedules`, `Lessons`, `AutomationLogs`, and `Settings`. The exact columns are declared in `SCHEMA_` in `gas/Code.gs`. Additional lesson fields preserve the student name and email at scheduling time, calendar identity, revision, pending operation, and change history.

Each data cell is **JSON encoded**, while the header row contains ordinary column names. For example, a name cell contains `"Anna"`, a duration contains `60`, and a reminders setting can contain `[1440,60,10]`. This preserves types and prevents user strings from becoming spreadsheet formulas. Do not replace JSON strings with unquoted text or rename headers. Prefer the application interface for edits.

Sheets writes are batched across the table's rows and persisted at operation checkpoints. Script locking serializes access. This is a small single-teacher database, not a replacement for a transactional database at large scale.

## Scheduling and recovery rules

- Recurring occurrence keys combine the stable schedule ID and local lesson date. A cancelled, completed, or individually rescheduled occurrence retains its key and will not be generated again.
- Interval weeks are anchored to the Monday of the effective-start week. Recurrence dates and times use the slot's timezone; UTC timestamps are stored for comparison.
- Nonexistent daylight-saving times are rejected. Ambiguous clock times use the selected earlier/later offset. Check local times when scheduling around clock changes.
- Conflicts include overlapping application lessons, the teaching calendar, and selected external calendars. Unavailable conflict calendars cause the operation to fail rather than assume availability.
- Rescheduling updates the existing event and preserves its conference when available. The application records the previous and updated times. A stale lesson revision requires refresh.
- Cancelling preserves the application lesson before requesting Calendar cancellation. Retry a failed cancellation from that lesson; do not delete its database row.
- Changing a recurring slot affects future generation. It does not silently rewrite already generated lessons. Reschedule existing lessons individually when needed.
- Pausing/inactivating a student stops new generation and requires a choice to retain or cancel existing future lessons. Review individual cancellation results.
- Attendance is entered by the teacher after the lesson starts. Time passing does not automatically mark lessons completed.
- Completed lessons retain the scheduled student's identity after profile edits. Notes remain editable.

### Calendar and invitation identity

Calendar event IDs are deterministic for each lesson. Private extended properties store the application name, lesson ID, and occurrence key. If an insert succeeds but its response or a subsequent Sheets write fails, a retry looks up the same event ID instead of creating a second event.

Only the lesson's snapshotted student email is included as an attendee. Events are private, guest invitations and modifications are disabled, and guest-list visibility is disabled. The student's invitation contains that event, not access to the teacher's whole calendar or student database.

Creation, updates, and cancellation use Calendar's `sendUpdates: "all"` notification request. **Requested** means Google accepted a notification request; it does not prove delivery or reading. Attendee responses are tracked separately as Needs Action, Accepted, Declined, or Tentative.

Meet creation uses `conferenceDataVersion: 1` and a per-lesson conference request ID. A failed conference retry uses a new request ID on the same event. After insertion, the adapter makes up to two short polling reads. Pending conferences stay pending until Google returns a valid Meet URL. With automation enabled, upcoming pending conferences are checked hourly; otherwise use Refresh calendar. No fabricated Meet URLs are used. A synchronized event can still have a pending or failed conference.

See [event insertion and conference parameters](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

### External edits and partial failures

Use Calendar synchronization to retrieve current conference, attendee, and event state. Externally deleted events are reported for review and are not silently recreated. Externally changed times are flagged as conflicts. Resolve the discrepancy deliberately rather than deleting occurrence keys or repeatedly bulk-generating.

Automation continues after individual failures and records counts plus safe error codes. Retry failed lessons individually. An existing failed lesson is treated as an existing occurrence during bulk generation; re-running the whole week does not implicitly retry every failed operation. Quota and authorization failures halt remaining Google work for that execution.

The engine has a conservative four-minute processing budget to leave room under Apps Script's execution limit. Work not processed before the deadline is reported; run another preview/generation to create still-missing occurrences, then retry failed existing lessons. There is no automatic paid or external fallback.

## Free usage quotas and limitations

**Verified against official Google documentation on 2026-11-26. Recheck before deployment or any quota-policy change.** Google limits can change and additional anti-abuse restrictions may apply.

| Limit | Published consumer-account value / application policy |
| --- | --- |
| Apps Script Calendar events created | 5,000 per day |
| Apps Script installable-trigger total runtime | 90 minutes per day |
| Apps Script execution runtime | 6 minutes per execution |
| Calendar API per-project rate | 10,000 requests per minute |
| Calendar API per-user-per-project rate | 600 requests per minute |
| Application request budget | 1,000 counted Calendar requests per rolling 24-hour window |
| Application quota-error response | Stop requests and apply a conservative cooldown; no automatic quota increases |

The request budget includes Calendar reads, availability checks, connection tests, writes, and counted retry attempts. It does not measure unrelated applications using the same Google account or project. Google may reject requests before the application's budget is reached. Safe bounded retries cover transient server errors; quota and authorization errors do not trigger a retry storm.

Google's current documentation states that Standard Tier projects do not incur Google Cloud charges. It also describes changes to tiering and future Scaled Tier billing. Remain in the Standard Tier; do not enroll in Scaled Tier, attach billing for higher quotas, or rely on an old statement that all Calendar API usage is always free.

The hard-coded `FREE_ONLY_MODE = true` and `ALLOW_PAID_SERVICES = false` prevent paid fallback behavior in the app. They do not override Google's account policies or inspect your project's billing enrollment. No AI service, payment information, external database, paid hosting, email vendor, or SMS service is required.

Official references: [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [Calendar API quotas](https://developers.google.com/workspace/calendar/api/guides/quotas), and [Workspace API usage tiers](https://developers.google.com/workspace/guides/quota-usage-tiers).

Apps Script mock events are stored in individual Script Properties with a 200-event development cap and an approximately 8 KB per-event cap. Production event records live in Google Calendar and Sheets. Export and clear development lessons before the cap is reached.

## Reminders

The application uses Google Calendar popup reminders on the calendar owner's event copy, with defaults of 24 hours, one hour, and ten minutes before the lesson. Students' personal reminder behavior depends on their Calendar settings. The application does not send additional student reminder emails and therefore needs no email-delivery service or email quota.

## Tests and checks

```powershell
npm test
npm run build
npm run check
```

Tests use Node's built-in test runner and mocked Google services. Default tests never create Google events, send invitations, or install live triggers. `check` verifies source syntax, the owner-only manifest, and generated build outputs. Test success does not establish that your account supports Meet or has authorized every scope.

For a live integration check, explicitly enable live mode in your own deployment, use a test student mailbox you control, and create a single future lesson. Confirm the correct attendee, unique event, conference state, reschedule notification, cancellation notification request, and preserved cancellation record. This manual live check is intentionally separate from the default test suite.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Setup required | Run `setup` as the intended owner in the Apps Script editor |
| Access denied or blank active identity | Sign in as the configured owner; verify accessing-user execution and Only myself access |
| Authorization revoked | Run an authorized function in the editor and complete Google's authorization flow |
| Meet unsupported | Choose a writable calendar that permits `hangoutsMeet`; check organization restrictions |
| Meet pending | Reconcile after Google processes the request; do not treat a pending conference as ready |
| Meet failed | Review the account's conference permissions, then retry that lesson |
| Calendar event missing or externally cancelled | Review the original lesson and Calendar state; the application will not silently recreate it |
| External time change | Reconcile, review the flagged lesson, and deliberately resolve the intended time |
| Conflict calendar unavailable | Restore read/free-busy access or remove that calendar from conflict settings |
| Quota reached | Wait for the displayed cooldown/budget reset; do not repeatedly force requests or raise paid quotas |
| Another operation is running | Wait and retry; the script lock prevents concurrent generation |
| Database schema/encoding error | Restore the matching backup; do not rename headers or paste unencoded values |
| Development calendar full | Export, then clear development lessons/logs before generating more |
| Weekly trigger did not run | Verify automation is enabled, inspect Apps Script Executions, reauthorize if needed, and check timezone and quota state |

Logs intentionally contain safe error codes and application IDs rather than credentials, raw Google error messages, or student email addresses.

## Security and privacy

Keep the web app, spreadsheet, script, and backups private. Never grant students access to the database or entire teaching calendar. Anyone with editor access to the script or spreadsheet may be able to read student data; the application's owner check cannot protect against those direct Google permissions.

The app validates server-side inputs, uses script locking, stores no frontend OAuth tokens, and escapes displayed user content. Local browser storage is not encrypted and should be used only on a trusted device. CSV/JSON exports contain personal information and should be stored and shared accordingly.

The initial release is designed for one teacher. Do not expand deployment access as a way to support additional teachers; that requires a separate authorization and data-isolation design.

## Backup and restore

### Production backup

1. Disable weekly automation and live operations before taking a coordinated backup.
2. Export student, schedule, lesson, and log datasets from the app for readable records.
3. Make a private copy of the Google Sheet, preserving all five sheets, headers, and JSON-encoded cells. A full spreadsheet copy is the primary restorable database backup.
4. Retain the matching source code and generated deployment files.
5. Record the `OWNER_EMAIL` and `SPREADSHEET_ID` Script Properties in a private operational note. Do not publish these identifiers alongside student data.

Application exports are useful for inspection, but they are not an automatic database import/restore mechanism. Do not paste CSV data directly over the JSON-encoded database.

### Production restore

1. Keep automation disabled and preserve a copy of the damaged database first.
2. Restore the complete backed-up sheet contents into the existing database, or change the script's `SPREADSHEET_ID` property to your private restored copy.
3. Retain the same authorized `OWNER_EMAIL`. Use source with the matching schema.
4. Confirm that all original lesson IDs, occurrence keys, calendar IDs, and event IDs remain intact. Never generate new IDs for restored lessons.
5. Open the app and inspect records. Check Calendar state against the restored data before enabling generation.
6. Test synchronization on one lesson, then restore live operations and the weekly trigger deliberately.

A database backup does not roll back Google Calendar. Events created or changed after the backup still exist there. Deterministic event IDs help recover uncertain inserts, but resolve any state differences before bulk generation. Never delete live Calendar events as part of a generic database restore.

For local development, retain browser data through the same browser profile and use exports before clearing storage. Clearing site data permanently removes that development workspace; no server copy exists.

## Maintenance

Recheck Google's quotas, scopes, conference support, and deployment settings before upgrading the app or enabling it in a different account. Rebuild and run all local checks after source changes. English is the single maintained interface and documentation language.

