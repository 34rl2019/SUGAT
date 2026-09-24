# Pilot implementation validation

This is the earlier implementation-stage record. The subsequent actual database,
Redis and real-stack browser results and current release decision are in
[SUGAT PILOT VALIDATION REPORT](PILOT_POST_IMPLEMENTATION_VALIDATION.md).

Validation performed on Windows on 2026-09-18 using Node 22.14.0 and pnpm 9.15.0.
The source workspace is on D:. Its dependency links could not be installed reliably,
so checks ran against a source copy under `%TEMP%\sugat-pilot-validation` with the
unchanged frozen lockfile. Original dependency directories were preserved as
`node_modules.pilot-backup` and ignored. No production migration or deployment ran.

## Executed checks

Commands below use `pnpm` as shorthand for the portable Node invocation of
`%TEMP%\sugat-pilot-tools\node_modules\pnpm\bin\pnpm.cjs`.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS in the validation copy. |
| `pnpm --filter @sugat/api prisma generate` | PASS. |
| `pnpm --filter @sugat/api prisma validate` | PASS, with a local dummy database URL; no database connection or migration. |
| `pnpm --filter @sugat/api test` | **137 passed, 1 failed**, across 19 suites. All new pilot tests passed. |
| `pnpm --filter @sugat/api build` | PASS. |
| `pnpm --filter @sugat/api exec tsc --noEmit --target es2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck scripts/e2e-final-release-gate.ts` | PASS; this compiles the integration harness, it does not execute it. |
| `pnpm --filter @sugat/passenger-web test` | PASS, 10 tests. |
| `pnpm --filter @sugat/admin-web test` | PASS, 2 tests. |
| `pnpm --filter @sugat/passenger-web exec tsc --noEmit` and the corresponding Admin Web command | PASS. |
| `pnpm --filter @sugat/passenger-web build` and the corresponding Admin Web command | PASS. |
| `pnpm --filter @sugat/passenger-mobile typecheck`, corresponding Driver Mobile and Admin Mobile commands | PASS. These are also the configured mobile lint checks. |
| `node --test apps/driver-mobile/src/location/queue-policy.test.mjs apps/driver-mobile/src/location/tracking-lifecycle.test.mjs` | PASS, 8 tests. |
| `pnpm --filter @sugat/passenger-mobile exec expo export --platform android --max-workers 2`, corresponding Driver Mobile and Admin Mobile commands | PASS for all three Android JavaScript/Hermes bundles. Not native APK builds. |
| `node apps/passenger-web/scripts/pilot-browser-smoke.cjs` | PASS in headless Edge at 1280px and 390px. |
| `git diff --check` | PASS. |

Mobile exports used `EXPO_PUBLIC_API_URL=https://api.example.test/api/v1`,
`EXPO_PUBLIC_APP_ENV=production`, `CI=true`, and `EXPO_NO_TELEMETRY=1`.
No separate ESLint/Prettier configuration exists. Modified and nearby UI strings
were reviewed for English-only copy.

The failing API test is the existing private-document-storage POSIX permission
assertion: it expects mode `0600`, while Windows reports `0666`. The storage service
and this test were not changed by the pilot implementation. This must be rerun on
the Linux validation environment; the full API suite is not reported as passing.
Redis-adapter error messages in the test output are deliberate outage-test cases.

## Browser smoke test

The isolated test starts local HTTP and Socket.IO fixtures, loads real OSM raster
tiles, and checks three independent marker positions, movement of only the matching
marker, FULL color without hiding the vehicle, reconnect, completion removal,
phone-width overflow, registered identity, optional sticker and the exact notice.
Fixtures are confined to the script and are never imported by production code.

Build the test bundle with explicit environment overrides (the app also has a
production environment file):

```powershell
$env:VITE_API_URL='http://127.0.0.1:3000/api/v1'
$env:VITE_SOCKET_URL='http://127.0.0.1:3000'
pnpm --filter @sugat/passenger-web build
```

The runner requires `playwright-core` (validated with 1.58.2) and `socket.io`
resolvable through Node. For this validation, playwright-core was installed only in
the temporary tools directory; `NODE_PATH` included that directory's `node_modules`
and the validation copy's `apps/api/node_modules`. Set `SUGAT_BROWSER_PATH` to an
installed Chromium/Edge executable. Local ports 3000 and 4177 must be free.
Only localhost and the public map tile host are allowed by the browser HTTP fixture.

## Outstanding release gates

- Run `scripts/e2e-final-release-gate.sh` against its isolated PostGIS/Redis setup.
  Docker/Compose are unavailable here, so real database migration, concurrent
  database constraints and Redis distribution/outage integration were not executed.
  The harness now includes autonomous operations, three-vehicle overview,
  occupancy and device reset in addition to the existing regression scenarios.
- Run the full API suite on Linux to verify the private file-permission assertion.
- Build/install native apps and verify MapLibre, SecureStore, background GPS,
  airplane-mode recovery and device replacement on actual phones. Java, adb and
  physical Android devices are unavailable here. iOS native validation also remains.
- Review/back up and apply `202609180001_pilot_operations` through the documented
  deployment workflow. Coordinate API/Driver Mobile rollout and Admin route grants:
  this migration revokes existing driver sessions, does not grant routes, and leaves
  old occupancy unknown. See `PILOT_OPERATIONS.md`.

Non-blocking build warnings: the Passenger Web MapLibre bundle exceeds Vite's
500 kB warning threshold; Prisma warns about the existing package.json configuration;
Node/Expo report existing module/color environment warnings.
