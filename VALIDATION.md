# Validation record

Verified 2026-11-26.

## Automated checks

All 56 tests pass with Node's built-in runner (`npm test`). No Google credentials, live events, email invitations, or live triggers are used by the tests.

Coverage includes student validation; multiple slots and students; recurring intervals and effective dates; repeat automation; deterministic event recovery; correct attendee isolation; local and external conflicts; pause/inactive behavior; individual rescheduling; cancellation tombstones; completed history snapshots; timezone boundaries; daylight-saving gaps and folds; pending and failed conferences; partial synchronization failure; revoked authorization; free-quota circuit breakers; bounded retries; owner authorization; locking; JSON-encoded Sheets persistence; live/mock separation; and weekly/hourly trigger lifecycle.

The production source and generated deployment files pass syntax, owner-only manifest, and build-freshness checks (`npm run check`).

## Browser checks

The local server returned HTTP 200. The application was exercised in the browser at a narrow mobile viewport and a 1440 × 1000 desktop viewport.

Observed successful workflows:

- Dashboard rendering, responsive layout, light/dark themes.
- Adding a development student and a recurring slot.
- Previewing and generating 12 simulated weekly lessons with a successful execution log.
- Creating a one-time simulated lesson.
- Rescheduling that lesson and showing its updated time and status.
- Cancelling it and preserving the cancelled record.
- Week/month calendar navigation and settings rendering.
- Reloading and retaining student, schedule, lesson, and log changes.

Browser test records use example.com addresses and remain development data.

## Integration boundary

The Google Apps Script backend, manifest, Sheets adapter, Calendar adapter, explicit live controls, and trigger handlers are included. They were tested with mocked Google services. No Google account was authorized or deployed during this build. Real OAuth consent, account-specific Meet support, invitation behavior, and server-trigger execution need the explicit live verification described in README.

Google requirements and quotas were checked against official documentation; references and verification date are in README. The application cannot inspect Cloud billing enrollment and requires the teacher to confirm the no-cost Standard Tier before enabling live writes.

P2 payments, prepaid packages, self-booking, and multiple teachers remain deferred. Extra student reminder emails are not implemented; native Calendar owner reminders are used.
