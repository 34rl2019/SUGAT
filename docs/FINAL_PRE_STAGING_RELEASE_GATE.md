# SUGAT FINAL PRE-STAGING RELEASE GATE

Executed 2026-09-18 on Windows with Node 22.14.0 and pnpm 9.15.0. Baseline remains
`main` at `4355b7acdc2e2f2190c463880f9138fcc24552f2`, including the existing dirty
implementation. [Initial status](validation/pre-staging-baseline-status.txt) was
recorded before changes. No production connection, data change, deployment, commit
or push occurred. Prior successful pilot validation was not treated as a new feature task.

| Gate | Result |
| --- | --- |
| LINUX API SUITE | **BLOCKED — LINUX ENVIRONMENT REQUIRED** |
| UNIX 0600 SECURITY TEST | **BLOCKED** on Linux; unchanged assertion fails on Windows |
| UTC DATABASE SAFETY | **PASS** |
| GPS TIMESTAMP REGRESSION | **PASS** |
| PHYSICAL DRIVER ANDROID | **BLOCKED — PHYSICAL ANDROID VALIDATION REQUIRED** |
| PHYSICAL PASSENGER ANDROID | **BLOCKED — PHYSICAL ANDROID VALIDATION REQUIRED** |
| REGRESSION TESTS | **FAIL** overall: 143 API tests pass, one Windows permission test fails; all other executed checks pass |

## SOFTWARE/AUTOMATED RELEASE GATE

**Not cleared pending the Linux API suite.** `wsl --status` reports WSL is not
installed; Docker and Podman are unavailable. No compatible Linux runtime was
available, so no Linux suite was executed: pass/fail counts are **not available**.
The required command on an Ubuntu validation host with frozen dependencies and a
generated Prisma client is `pnpm --filter @sugat/api test`.

The actual Windows rerun of that exact command produced **143 passed / 1 failed**,
19 passed suites / 1 failed suite. The only failure is
`PrivateDocumentStorageService > validates content signatures, uses non-guessable
names, and stores private files`: expected `0600` (384), received `0666` (438).
Neither the security assertion nor the private-storage implementation was modified.
The six new UTC policy tests pass. No Linux pass is inferred from Windows behavior.

### UTC root cause and correction

The existing database uses Prisma `DateTime` / PostgreSQL `timestamp(3)` columns
to store UTC wall-clock values. GPS raw SQL supplies a Date parameter and
`CURRENT_TIMESTAMP`; conversion from timezone-aware instants to those columns
depends on the session timezone. Database-generated `receivedAt` and event times
have the same dependency. Correcting only one raw GPS expression would leave those
other defaults exposed.

`PrismaService` now sets the PostgreSQL startup option `-c timezone=UTC` in its
datasource URL for **every pooled connection**, including reconnects. Existing URL
settings are preserved; conflicting timezone options precede the enforced UTC
option. Startup checks the actual database session and disconnects/rejects on a
mismatch. `/readiness` also verifies UTC instead of merely issuing `SELECT 1`.
No timestamp schema, GPS ingest architecture, public contract or freshness threshold
was changed.

This uses the documented Prisma PostgreSQL
[connection startup options](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql)
and PostgreSQL's
[connection options](https://www.postgresql.org/docs/16/libpq-connect.html).
The integration test verifies their behavior with the installed Prisma client,
rather than relying only on configuration inspection.

| Timestamp path reviewed | Coverage/evidence |
| --- | --- |
| GPS `recordedAt` / raw current-location upsert | Real `TripsService` ingestion with a `+08:00` input round-trips to the exact UTC instant. Raw SQL receives UTC sessions. |
| `VehicleCurrentLocation.updatedAt` | Database-generated timestamp remains near current UTC, not shifted seven/eight hours. |
| `Trip.lastLocationAt` | Prisma write equals promoted `recordedAt`; batch/replay/stale events do not regress it. |
| `GpsIngestionEvent.receivedAt`, expiry | Promoted and rejected receipt times checked; expiry remains in the future. All Prisma writes use guarded connections. |
| Trip events/history | Real stop event `createdAt` checked. Current API no longer writes legacy `TripLocationHistory`; retained historical rows and deferred contract migration were not changed. Maintenance/migration connections also require UTC. |
| ETA/freshness | Public LIVE state and available boarding ETA checked; deterministic STALE/OFFLINE aging unchanged. Existing full E2E ETA gates pass. |
| HTTP/realtime | Public location Date and emitted `recordedAt` match the input instant normalized to UTC ISO. Full Socket.IO/Redis E2E passes. |

### Deliberately non-UTC validation

Only the retained isolated database `sugat_pilot_validation_1789739146930` on
`127.0.0.1:55432` was changed to default to `America/Los_Angeles`. An unguarded
connection confirmed that default. Dedicated tests also supplied conflicting
`America/Los_Angeles` and `Asia/Manila` startup options. For each zone:

- The unguarded non-UTC connection failed the UTC assertion.
- Five simultaneously held API transactions had five distinct PostgreSQL backend
  PIDs, all reporting `UTC`.
- Disconnect/reconnect continued to report UTC.
- Real GPS/default/event timestamp checks, batch ordering, duplicates, stale and
  future rejection passed; explicit session drift was detected by the guard.

The complete database/Redis E2E then passed **20/20 groups** against that non-UTC
database default using two rebuilt API instances. Both actual `/readiness` endpoints
returned `ready`. Redis outage/recovery, persistence, Passenger/Admin HTTP, realtime
recovery and concurrent completion also passed. The isolated database default was
restored to UTC afterward; all owned services were stopped and retained data preserved.

### Exact executed regression commands

These ran in the synchronized NTFS validation copy, using existing frozen
dependencies. `pnpm` below denotes the portable Node/pnpm invocation. Full executable
paths, argument arrays, working directories, times, exit codes and retained logs:
[source checks](validation/pre-staging-source-results.json),
[integration checks](validation/pre-staging-integration-results.json).

| Command | Result/count |
| --- | --- |
| `pnpm --filter @sugat/api exec jest --runInBand --runTestsByPath src/common/database-utc.spec.ts` | PASS, 6 tests |
| `pnpm --filter @sugat/api prisma validate` | PASS |
| `pnpm --filter @sugat/api build` | PASS |
| `pnpm --filter @sugat/api test` | FAIL, 143 passed / 1 failed |
| `pnpm --filter @sugat/passenger-web test` | PASS, 11 tests |
| `pnpm --filter @sugat/api exec tsc --noEmit` | PASS |
| `pnpm --filter @sugat/passenger-web exec tsc --noEmit` | PASS |
| `pnpm --filter @sugat/passenger-mobile typecheck` | PASS |
| `pnpm --filter @sugat/api exec tsc --noEmit --target es2022 --module commonjs --moduleResolution node --esModuleInterop --experimentalDecorators --emitDecoratorMetadata --skipLibCheck scripts/utc-release-gate.ts` | PASS |
| `pnpm --filter @sugat/api exec tsx scripts/utc-release-gate.ts` | PASS, both non-UTC zones and all timestamp assertions |
| `pnpm --filter @sugat/api exec tsx scripts/e2e-final-release-gate.ts` | PASS, 20 groups / 0 failures |
| `git -c "safe.directory=D:/MY APP/SUGAT_APP" -c core.autocrlf=false diff --check` | PASS |

One initial focused invocation used unsupported pnpm arguments (`test
--runTestsByPath`) and ran no tests; the corrected explicit Jest invocation above
passed. Final source batch: **8/9 commands pass**. Integration batch: **2/2 pass**.
No mobile export was repeated or counted as physical-device evidence.

Reproduction of the Windows checks uses the isolated wrapper (secrets stay in TEMP):

```powershell
$validationNode = Join-Path $env:TEMP 'sugat-pilot-tools\node-v22.14.0-win-x64\node.exe'
& $validationNode scripts/pilot-validation-local.cjs node 'D:\MY APP\SUGAT_APP\scripts\pre-staging-checks.cjs' 'D:\MY APP\SUGAT_APP'
& $validationNode scripts/pilot-validation-local.cjs node 'D:\MY APP\SUGAT_APP\scripts\pre-staging-checks.cjs' 'D:\MY APP\SUGAT_APP' integration
```

The integration batch requires the isolated database, Redis and rebuilt API processes
running. The `non-utc` wrapper action changes only that isolated database's default;
`utc` restores it. Validation scripts reject production/ordinary development targets.

### Staging/production UTC requirement

Use direct PostgreSQL sessions with `TimeZone=UTC`. Retain
`options=-c%20timezone%3DUTC` in CLI/seed/import connection URLs; the API additionally
enforces it internally. Verify the actual maintenance connection with `SHOW TimeZone`
and each API instance with `/readiness`. Operating-system `TZ` alone is insufficient.
No production setting was read or changed. Connection proxies that discard startup
options or substitute differently configured sessions are outside the validated
architecture. Do not change application sessions to a non-UTC zone. Existing
historical corruption, if found, requires a separate reviewed repair; this fix does
not rewrite history. See [deployment requirements](../deploy/DEPLOYMENT.md).

## PHYSICAL DEVICE RELEASE GATE

**BLOCKED — PHYSICAL ANDROID VALIDATION REQUIRED** for Driver and Passenger.
No accessible physical Android validation setup/ADB was available. All rows in
[the existing checklist](validation/PILOT_ANDROID_MANUAL_CHECKLIST.md) remain NOT RUN.
Driver: first binding, logout/login persistence, START, background/locked-screen GPS,
network loss, durable queue/recovery/sync, FULL/VACANT, END, Admin reset, old-device
rejection and replacement authorization. Passenger: search, multiple independent
markers, occupancy, freshness, vehicle name/plate/notice, reconnect and removal on
completion. Exports and typechecks do not clear this gate.

## FIXES MADE

- Forced UTC on every API Prisma connection; fail-closed startup and readiness checks.
- Added six unit tests and an isolated real-database UTC/GPS regression runner.
- Documented UTC connection requirements in deployment instructions and `.env.example`.
- Added isolated non-UTC validation control and recorded regression evidence.

## REMAINING BLOCKERS

1. Run the complete API suite on compatible Ubuntu/Linux; verify the unchanged Unix
   `0600` security assertion passes. No Linux result is available here.
2. Execute and record both physical Android checklists. No native-runtime pass is
   available here.

The UTC software blocker is resolved by the tested configuration/guard; application
of the documented requirements remains part of a future authorized deployment.

## FINAL STATUS

**NOT READY FOR STAGING**
