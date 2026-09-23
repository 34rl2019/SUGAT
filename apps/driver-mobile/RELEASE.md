# SUGAT Driver Mobile Release Guide

The shared build-only release policy and cross-application matrix are documented in [`docs/MOBILE_RELEASE_POLICY.md`](../../docs/MOBILE_RELEASE_POLICY.md).

## Application identity

- Android package: `online.sugata.driver`
- iOS bundle identifier: `online.sugata.driver`
- Expo owner/project: `sugata-app/sugat-driver`
- Expo project ID: `db7e3d62-0fa2-445f-8c69-a6e3284c37ca`
- Expo slug: `sugat-driver`
- URL scheme: `sugat-driver`
- Public version: `0.1.0`

These identifiers are committed build configuration and must not be changed between releases. The project is linked to the organization-owned Expo project; never replace its project ID with one from another app.

EAS uses remote app-version management. Production builds use `autoIncrement`, so Android version codes and iOS build numbers advance without changing the public version for every rebuild.

## Build profiles

Install the locked workspace dependencies first:

```bash
corepack pnpm install --frozen-lockfile
```

- `development`: internal development-client APK, Android emulator API at `http://10.0.2.2:3000/api/v1`, and cleartext traffic enabled. Override the public API URL when testing on a physical LAN device.
- `preview`: standalone internal APK connected to `https://api-staging.sugata.online/api/v1` for controlled physical testing.
- `production`: Android App Bundle connected to `https://api.sugata.online/api/v1`, with remote build-number auto-increment.

The project does not intentionally configure `expo-updates`; build profiles therefore do not declare OTA channels.

Commands:

```bash
corepack pnpm --filter @sugat/driver-mobile run build:android:development
corepack pnpm --filter @sugat/driver-mobile run build:android:preview
corepack pnpm --filter @sugat/driver-mobile run build:android:production
```

EAS builds require an organization-authorized Expo account and managed Android/iOS signing credentials. Package identifiers and API URLs are public configuration, not secrets. Never commit Expo tokens, keystores, signing passwords, or Apple credentials.

## Configuration validation

`EXPO_PUBLIC_APP_ENV` is `development`, `preview`, or `production`. Preview and production builds reject missing, local, non-HTTPS API URLs. Development is the only profile that permits HTTP, and only when `SUGAT_ALLOW_HTTP=true`.

Validate the resolved production configuration and JavaScript bundle with:

```bash
EXPO_PUBLIC_APP_ENV=production EXPO_PUBLIC_API_URL=https://api.sugata.online/api/v1 SUGAT_ALLOW_HTTP=false EAS_BUILD_PROFILE=production \
  corepack pnpm --filter @sugat/driver-mobile exec expo config --type public

EXPO_PUBLIC_APP_ENV=production EXPO_PUBLIC_API_URL=https://api.sugata.online/api/v1 SUGAT_ALLOW_HTTP=false EAS_BUILD_PROFILE=production \
  corepack pnpm --filter @sugat/driver-mobile exec expo export --platform android
```

## Physical Android release checklist

Record the device model, Android version, build reference, API environment, and result for every case.

- Fresh install: sign in, complete any temporary-password change, grant notifications and precise/background location, and confirm the assignment.
- Foreground GPS: start the trip and confirm server current location and the tracking notification.
- Background GPS: minimize the app, move safely, and confirm updates continue.
- Locked screen: lock the screen, move safely, and confirm updates continue.
- Network loss: disable Wi-Fi/mobile data and confirm the visible queue increases without ending tracking.
- Network restoration: restore connectivity and confirm the queue clears and the server receives the newest trusted point.
- App restart: restart during an active trip and confirm assignment reconciliation and tracking restoration.
- Permission revocation: revoke location permission, return to the app, and confirm recovery guidance appears and tracking is not reported ready.
- Location services disabled: disable device Location and confirm the app blocks a new trip from silently starting.
- Battery restrictions: open the provided Android background settings, permit reliable background operation, and record manufacturer-specific behavior.
- Trip completion: complete the trip, confirm the foreground service stops, and confirm no later GPS submission is authorized.

iOS configuration includes foreground/background descriptions and the location background mode, but requires separate native-device and Apple-signing verification.

### Background tracking and process-death matrix

For every row, record device model, Android version, build reference, timestamps,
API environment, observed result, and PASS/FAIL. Confirm server state through an
authorized operational view and Passenger state through an anonymous client.

| Case | Action | Expected Driver UI | Expected server trip | Expected GPS | Expected queue | Expected Passenger state |
|---|---|---|---|---|---|---|
| 1 | Start trip, lock screen, travel safely | ACTIVE after unlock; foreground-service notification present | ACTIVE | Updates continue | Normally clear | Vehicle continues moving |
| 2 | Start trip, swipe UI from recents | UI absent; foreground-service notification remains | ACTIVE | Background updates continue | Clear or transient | Vehicle continues moving |
| 3 | Reopen during active trip | Same assignment restored, not duplicated | Same ACTIVE trip | Existing task reused or restarted once | Existing queue syncs | Same trip remains live |
| 4 | Complete normally | Completion confirmed; no active assignment | COMPLETED | Task and notification stop | Completed-trip queue removed | Trip disappears/completion received |
| 5 | Reopen after normal completion | No active assignment | COMPLETED | Remains stopped | No completed-trip events | No live location |
| 6 | Force-stop/kill at several points around the completion response, then reopen | Reconciles to server truth; never claims false completion | ACTIVE if request failed; COMPLETED if accepted | Continues for ACTIVE; stops for COMPLETED | Preserved for ACTIVE; discarded for completed stale ID | Live only while server is ACTIVE |
| 7 | Disable all internet during ACTIVE trip | Offline warning and increasing queue | ACTIVE | Collection continues | Increases, bounded at 5,000 | Last point ages stale/offline |
| 8 | Restore internet | Online; last upload advances | ACTIVE | Upload resumes | Drains in batches | Current position resumes |
| 9 | Restart phone during ACTIVE trip, then open app | Same ACTIVE assignment restored | ACTIVE | Task starts/reuses once after permissions are ready | Preserved and synced | Tracking resumes without duplicate trip |
| 10 | Restart phone after COMPLETED trip, then open app | No active assignment | COMPLETED | Any stale task/ID is stopped and cleared | Completed stale queue discarded | No live location |
| 11 | Expire/revoke authentication during ACTIVE trip | Session-expired login state on reconciliation | Remains authoritative ACTIVE until operationally resolved | Local tracking stops after authentication failure; no anonymous tracking | Local trip queue is discarded under the privacy-first policy | Last point ages stale/offline |
| 12 | Enable battery optimization during ACTIVE trip | Guidance remains available | ACTIVE | Record OEM delay/termination behavior | May grow if uploads pause | May age stale/offline |
| 13 | Grant battery-optimization exemption and repeat | ACTIVE with normal status | ACTIVE | Expected five-second/15-metre behavior resumes | Normally clear | Normal live movement |

Local reconciliation uses a privacy-first stale-data policy: after the server
confirms there is no matching ACTIVE trip, or authentication can no longer be
renewed, it stops the task, clears the persisted trip ID, and discards queued
coordinates for that non-authoritative trip. A network/server outage alone does
not stop an ACTIVE local trip; tracking and bounded queueing continue offline.
