# Teaching Scheduler implementation

1. Build a dependency-free scheduling engine shared by Apps Script and the local development application.
2. Persist students, recurring slots, lessons, settings, and execution logs. Snapshot student identity on lessons.
3. Add Calendar adapters with deterministic event IDs, private extended properties, conference polling, attendee isolation, fail-closed conflict checks, and quota circuit breakers.
4. Add owner-only Apps Script RPC, Sheets storage, and explicitly enabled weekly triggers. Default to mock mode with all live writes disabled.
5. Build responsive dashboard, student editing, recurring schedules, calendar views, attendance/history, logs, settings, and exports.
6. Exercise the shared engine and mocked Google services, including retries, cancellation tombstones, DST, permission failures, and partial failures.
7. Package generated Apps Script files, document Google setup and recovery, and provide a local preview.

Hosting target: Google Apps Script HTML Service, as explicitly requested. No other hosting infrastructure is provisioned. Local mode uses browser storage and never calls Google.

Google requirements verified 2026-11-26 from official documentation. See README for links and account-dependent limitations. Payments remain deferred until the core is validated.
