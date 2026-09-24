# SUGAT PILOT VALIDATION REPORT

Follow-up: [FINAL PRE-STAGING RELEASE GATE](FINAL_PRE_STAGING_RELEASE_GATE.md)
records the subsequent UTC hardening and the remaining Linux/physical-device gates.
This report retains the earlier findings as historical evidence.

Validation date: 2026-09-18. Repository baseline: `main`, commit
`4355b7acdc2e2f2190c463880f9138fcc24552f2`, with existing uncommitted implementation
work preserved. [Initial status](validation/pilot-baseline-status.txt) records that
baseline. No production connection, production migration, deployment, commit or push
was performed.

## A. OVERALL RESULT

**VALIDATION INCOMPLETE — ENVIRONMENT LIMITATIONS**

Actual isolated database, Redis, API and browser validation passed with UTC database
sessions. Final source checks passed 18/19; the full API suite remains red on Windows.
Linux private-file permissions and physical Android behavior are not cleared.

## B. DATABASE

| Gate | Result | Evidence |
| --- | --- | --- |
| Migration | PASS | Five preceding migrations applied normally to a new database, historical fixtures inserted, then `202609180001_pilot_operations` applied successfully. Final migration status: six migrations, schema up to date. No reset or schema push. |
| PostgreSQL/PostGIS | PASS | PostgreSQL 16.15, PostGIS 3.4.2. Prisma queries, SRID 4326, actual geography distance 1106.07864644 meters, and generated Stop/current-location geography checked. |
| Data integrity | PASS | Historical ACTIVE/COMPLETED trips, schedules, route stops and current location survived migration. Existing occupancy/timestamp/sticker remained null; only Driver sessions were revoked. Admin session survived; no implicit route grants/device bindings. New grants, devices, stickers, unscheduled trips and FULL persisted. Both active Driver and Vehicle uniqueness indexes independently rejected conflicts. Capacity stayed unchanged. |

The isolated database was `sugat_pilot_validation_1789739146930` on
`127.0.0.1:55432`. It was created in a new temporary PostgreSQL cluster with random
credentials; ordinary development and production databases were not used.
Migration SQL review found additive structures, intentional nullable schedule fields
and Driver-session revocation; no destructive reset/drop of historical business data.

**UTC prerequisite discovered:** the initial offline-batch test failed under the
portable database's `America/Los_Angeles` session timezone. A stored GPS timestamp
was `2026-09-18T06:51:03.836Z` instead of `2026-09-18T13:51:03.836Z`.
The existing raw SQL promotion path inserts a Date into `TIMESTAMP(3)` and depends
on session timezone. Only the isolated database was changed to UTC, API connections
were restarted, and all GPS/integration gates then passed. `SHOW TimeZone` confirmed
UTC. GPS production code was not rewritten. Staging must verify UTC through its
actual API database connections, or this needs a separate explicit UTC-conversion
fix and regression test before clearance. Production timezone was not inspected.

## C. REDIS / REALTIME

| Gate | Result | Evidence |
| --- | --- | --- |
| Redis | PASS | Isolated Redis 7.2.8 on `127.0.0.1:56379`; two API instances on 53000/53001. API survived Redis interruption; database persistence and Passenger/Admin HTTP remained available. Adapter recovered without API restart. |
| Multi-trip subscriptions | PASS | `/live`, three matching trip rooms, writes on API 1 delivered through Redis to API 2. Unrelated trip events, invalid IDs and privileged Admin subscription rejected/excluded. |
| GPS realtime | PASS | Each of three updates changed only its own trip/marker. Existing idempotency, quarantine, ordering and stop progression gates passed. |
| Occupancy realtime | PASS | FULL/VACANT persisted and propagated independently; FULL remained ACTIVE, visible and continued GPS. Unknown stayed neutral. |
| Reconnect/reconciliation | PASS | Resubscription, real approximately 30-second HTTP fallback with WebSockets blocked, selected-trip retention and completion removal passed. Delayed actual HTTP response did not resurrect a completed trip; unit coverage also protects newer GPS/occupancy from older snapshots. |

Redis used a Windows MSYS2 build; this is actual Redis integration evidence, not a
Linux platform-parity claim. Archive provenance/hashes are recorded in
[portable-archive-hashes.json](validation/portable-archive-hashes.json).
All isolated services were stopped after validation; PostgreSQL fixtures retained.

## D. DRIVER OPERATIONS

| Gate | Result | Evidence |
| --- | --- | --- |
| Operating route and vehicle validation | PASS | Autonomous START uses a registered active route and assigned active vehicle; unknown routes and unauthorized vehicles are rejected server-side. |
| Autonomous START | PASS | Actual API start with no schedule/READY trip: ACTIVE, actual start time, registered Driver/Vehicle/Route, VACANT. Restart after END succeeded without adding a schedule. |
| Duplicate prevention | PASS | API conflicts and both independent database uniqueness constraints checked. |
| FULL/VACANT | PASS | Persistence, event identity, isolation from other trips, visibility and continued GPS checked. |
| END | PASS | Completion persisted and removed Passenger trip/marker. Concurrent completion has one winner and one event. |

These are database/API results. Native Driver execution is still blocked on phones.

## E. PASSENGER

| Gate | Result | Evidence |
| --- | --- | --- |
| Search | PASS | Forward/reverse direction, ordered stops, boarding/dropoff flags, passed stops and ACTIVE filtering. Existing E2E exercises A-to-D; additional browser fixture uses B-to-D to respect the existing passed-origin rule. |
| Multiple Vehicles | PASS | Three actual matching active trips with distinct vehicles/coordinates; initial overview and independent movements checked. Unrelated reverse trip excluded. |
| Passenger Web Map | PASS | Real MapLibre and OSM tiles in headless Edge 153 at 1280x844 and 390x844, against actual local APIs/DB/Redis. Marker selection, card identity, updates, reconnect and no horizontal overflow checked. |
| Passenger Mobile | BLOCKED | Shared overview tests, code review, typecheck and Android Expo export pass. Physical native map/runtime not run. |
| Vehicle identity | PASS | Registered name/plate and optional sticker; correct selected vehicle. Exact required boarding notice asserted in browser and unit tests. |
| Freshness | PASS | VACANT+LIVE, FULL+LIVE, VACANT+STALE and FULL+OFFLINE; unknown occupancy remains distinct. Real aging plus isolated timestamp simulation; stale ETA qualified, offline ETA unavailable. Thresholds unchanged. |

Native mobile paths use the shared overview reconciler for multi-trip subscription,
selection, occupancy, freshness and completion. Code/export evidence does not establish
Android marker bitmap updates, location services or SecureStore runtime correctness.

## F. DEVICE SECURITY

| Gate | Result | Evidence |
| --- | --- | --- |
| Device binding | PASS | First legitimate credential binds; same credential accepted; logout preserves binding. |
| Second-device rejection | PASS | Different credential rejected while original binding remains. |
| Admin reset | PASS | Reset revokes authorization/sessions and permits replacement authorization. |
| Old-device revocation | PASS | Old credential cannot START, END, change occupancy or upload GPS after reset. Ownership/other-driver operations also rejected. |
| Native SecureStore runtime | BLOCKED | No physical Android device; persistence/replacement behavior requires the manual gate. |

Server stores a hashed, revocable representation of a random device credential.
This is credential-possession security, not hardware attestation. Client code retains
the device credential across logout in SecureStore; native execution is not inferred.

## G. REGRESSION TESTS

The D: dependency-link limitation required a synchronized source copy at
`C:\Users\angub\AppData\Local\Temp\sugat-pilot-validation`, with frozen dependencies.
Original dependency directories and user changes were retained. Node 22.14.0 and
pnpm 9.15.0 were used. Exact executable paths, argument arrays, working directories,
timestamps, exit codes and local log names for all 19 final checks are in
[pilot-source-results.json](validation/pilot-source-results.json).

Commands below use `pnpm` for that recorded portable Node/pnpm invocation and `node`
for that Node executable. All database commands were launched through this wrapper,
which supplies only isolated credentials (not included in committed files):

```powershell
$validationNode = Join-Path $env:TEMP 'sugat-pilot-tools\node-v22.14.0-win-x64\node.exe'
& $validationNode scripts/pilot-validation-local.cjs pnpm <arguments>
```

For the first migration command, `$baselineSchema` was
`C:\Users\angub\AppData\Local\Temp\sugat-post-validation\baseline\schema.prisma`;
that directory contained only the five pre-pilot migrations and schema. Migration
fixture `baseline` and `verify` modes must run once in that order on a fresh database;
they are intentionally not idempotent.

| Exact command / arguments | Result | Passed | Failed |
| --- | --- | ---: | ---: |
| `pnpm --filter @sugat/api prisma migrate deploy --schema "$baselineSchema"` | PASS | 5 migrations | 0 |
| `pnpm --filter @sugat/api exec tsx scripts/pilot-migration-gate.ts baseline` | PASS | 1 fixture gate | 0 |
| `pnpm --filter @sugat/api prisma migrate deploy` | PASS | 1 pilot migration | 0 |
| `pnpm --filter @sugat/api exec tsx scripts/pilot-migration-gate.ts verify` | PASS | 1 integrity gate | 0 |
| `pnpm --filter @sugat/api exec tsx scripts/pilot-migration-gate.ts geography` | PASS | 1 geography/UTC gate | 0 |
| `pnpm --filter @sugat/api prisma migrate status` | PASS | 1 command; 6 applied | 0 |
| `pnpm --filter @sugat/api prisma generate` | PASS | 1 command | 0 |
| `pnpm --filter @sugat/api prisma validate` | PASS | 1 command | 0 |
| `pnpm --filter @sugat/api test` | FAIL | 137 tests; 18 suites | 1 test; 1 suite |
| `pnpm --filter @sugat/api build` | PASS | 1 build | 0 |
| `pnpm --filter @sugat/api exec tsx scripts/e2e-final-release-gate.ts` | PASS, final UTC run | 20 groups | 0 |
| `pnpm --filter @sugat/api exec tsx scripts/pilot-stack-browser.ts` | PASS, final run | 2 browser viewports plus API/Redis assertions | 0 |
| `pnpm --filter @sugat/passenger-web test` | PASS | 11 tests | 0 |
| `pnpm --filter @sugat/admin-web test` | PASS | 2 tests | 0 |
| `node --test apps/driver-mobile/src/location/queue-policy.test.mjs apps/driver-mobile/src/location/tracking-lifecycle.test.mjs` | PASS | 8 tests | 0 |
| `pnpm --filter @sugat/passenger-web exec tsc --noEmit` | PASS | 1 check | 0 |
| `pnpm --filter @sugat/admin-web exec tsc --noEmit` | PASS | 1 check | 0 |
| `pnpm --filter @sugat/passenger-mobile typecheck` | PASS | 1 check | 0 |
| `pnpm --filter @sugat/driver-mobile typecheck` | PASS | 1 check | 0 |
| `pnpm --filter @sugat/admin-mobile typecheck` | PASS | 1 check | 0 |
| `pnpm --filter @sugat/passenger-web build` | PASS | 1 build | 0 |
| `pnpm --filter @sugat/admin-web build` | PASS | 1 build | 0 |
| `pnpm --filter @sugat/passenger-mobile exec expo export --platform android --max-workers 2` | PASS | 1 JS/Hermes export | 0 |
| `pnpm --filter @sugat/driver-mobile exec expo export --platform android --max-workers 2` | PASS | 1 JS/Hermes export | 0 |
| `pnpm --filter @sugat/admin-mobile exec expo export --platform android --max-workers 2` | PASS | 1 JS/Hermes export | 0 |
| `pnpm --filter @sugat/api exec tsc --noEmit --target es2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck scripts/e2e-final-release-gate.ts scripts/pilot-migration-gate.ts scripts/pilot-stack-browser.ts` | PASS | 1 compilation | 0 |
| `git -c "safe.directory=D:/MY APP/SUGAT_APP" -c core.autocrlf=false diff --check` | PASS | 1 check | 0 |

Builds/exports used `NODE_ENV=production`. Web overrides were
`VITE_API_URL=http://127.0.0.1:53000/api/v1` and
`VITE_SOCKET_URL=http://127.0.0.1:53001`; mobile exports used
`EXPO_PUBLIC_API_URL=https://api.example.test/api/v1`,
`EXPO_PUBLIC_APP_ENV=production`, `CI=true`, `EXPO_NO_TELEMETRY=1`.
No native APK/device test is included in the export counts.

Supporting lifecycle commands were `& $validationNode
scripts/pilot-validation-local.cjs init`, `postgres-start` (after the interrupted
initial setup), `pnpm --filter @sugat/api prisma db seed`, `api`, `api-stop`, `utc`,
and a subsequent `api` restart. Redis `start`/`stop` were invoked by the E2E outage
hook. Final `api-stop` and `shutdown` succeeded, retaining the isolated database.
The initial setup needed Windows runtime DLLs and an MSYS path correction; no system
service was installed. These setup retries are not application test passes.

The final 19-command batch was invoked exactly as:

```powershell
& $validationNode scripts/pilot-validation-local.cjs node 'D:\MY APP\SUGAT_APP\scripts\pilot-source-checks.cjs' 'D:\MY APP\SUGAT_APP'
```

API unit failure: `PrivateDocumentStorageService` private-file mode assertion,
expected decimal 384 (`0600`), received 438 (`0666`) on Windows. **LINUX RERUN
REQUIRED.** No skip, weakened assertion or permission-control change was made.

[Full E2E result](validation/pilot-e2e-results.json): all 20 groups PASS, including
valid/duplicate/out-of-order GPS, offline batch, stop progression, quarantine,
Passenger/Admin realtime, realtime security, lifecycle, reconnect, Redis outage,
ETA, concurrent completion, Passenger/Admin/security E2E and all three pilot groups.

Earlier unsuccessful runs are not counted as passing: initial non-UTC offline batch;
portable Redis shutdown harness treating the expected connection closure as failure;
browser harness assumptions about subpixel movement, overlapping marker hit targets
and offline toggling. Harness corrections use valid larger GPS movement, exposed
marker hit points and explicit real WebSocket interruption. The slow-initial-search
unit regression failed before the production correction and passed afterward.

## H. FIXES MADE DURING VALIDATION

- `packages/shared-utils/src/passenger-tracking.ts`: prevent the five-second freshness
  timer from publishing a false successful empty search before the initial HTTP
  snapshot exists. Shared Passenger Web/Mobile behavior; no UI redesign.
- `apps/passenger-web/src/overview.test.ts`: regression for that pending-response
  state and assertion that older HTTP occupancy cannot overwrite newer FULL.
  Final 11 tests and real-stack browser gates passed after the fix.
- Validation infrastructure: isolated-target guards, migration/geography/browser
  runners, Windows portable Redis outage hook, clearer GPS timestamp diagnostics,
  inclusion of pilot groups in the shell gate summary, exact source-check records
  and Android checklist. No GPS architecture, freshness thresholds, API contract or
  security expectation changed.
- Configured only the isolated test database for UTC. This is an environment
  prerequisite correction, not a claim that production timestamp handling was fixed.

## I. BLOCKERS

1. **LINUX RERUN REQUIRED:** run the unchanged full API suite on Linux and obtain a
   passing private-storage `0600` assertion before staging clearance.
2. **UTC session prerequisite:** verify the intended staging API connections report
   UTC and rerun GPS offline-batch/promotion there. Otherwise address the existing
   timestamp-conversion defect separately before progression.
3. **MANUAL DEVICE TEST REQUIRED:** no physical Android execution. This blocks pilot
   clearance for background GPS, queue recovery, native maps and SecureStore; it can
   be exercised on staging after the preceding staging prerequisites are resolved.

## J. MANUAL DEVICE TESTS STILL REQUIRED

All entries in [the Android checklist](validation/PILOT_ANDROID_MANUAL_CHECKLIST.md)
are **MANUAL DEVICE TEST REQUIRED**, not PASS. Driver: first/same/second phone login,
logout persistence, START/FULL/VACANT/END/restart, background and locked-screen GPS,
network loss/recovery and queued sync, Admin reset, old-phone rejection and replacement
authorization. Passenger: origin/destination, three native markers and independent
movement, occupancy/unknown state, freshness aging, selected details and plate/name
verification, reconnect/HTTP fallback and completion. Record devices/builds and actual
observations before signing off.

## K. NON-BLOCKING ISSUES

- Passenger Web bundle warning: 1,261.30 kB minified JavaScript / 351.20 kB gzip.
  **NON-BLOCKING**: build and actual desktop/phone-browser functional gates passed;
  warning alone establishes no runtime failure. Low-end physical-device performance
  remains unmeasured. Code splitting can be considered separately.
- Prisma warns that `package.json#prisma` is deprecated for a future major version;
  current generate, validate, migration and build commands pass.
- Nearby map labels can overlap at overview zoom; selection of an exposed marker
  area and corresponding result-card identity passed. No map redesign was made.

## L. NEXT RECOMMENDED ACTION

**Resolve the listed blockers before staging.**
