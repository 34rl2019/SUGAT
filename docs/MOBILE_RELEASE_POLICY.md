# SUGAT Mobile Release Policy

SUGAT v1 mobile applications use signed native builds only. EAS Update is disabled: `expo-updates`, update URLs, channels, and `runtimeVersion` are intentionally absent. JavaScript changes ship in a new signed binary, so native permission, background-location, Expo SDK, React Native, or native-module changes cannot reach an incompatible installed application.

## Application identity

| Application | Expo owner/slug | Expo project ID | Android package |
|---|---|---|---|
| Driver | `sugata-app/sugat-driver` | `db7e3d62-0fa2-445f-8c69-a6e3284c37ca` | `online.sugata.driver` |
| Passenger | `sugata-app/sugat-passenger` | `b57a0a43-3955-4f55-aa94-bfef0f10bc51` | `ph.sugata.passenger` |
| Admin | `sugata-app/sugat-admin` | `b2fa902a-53e1-4854-8bd6-eef75cb16d7c` | `ph.sugata.admin` |

The slugs, schemes, Android packages, and organization-owned Expo project IDs are unique. Never copy one application's project ID into another application.

## Build profiles

| Profile | Artifact/distribution | API environment | Updates |
|---|---|---|---|
| Development | Internal development-client APK | Android emulator HTTP URL; `SUGAT_ALLOW_HTTP=true` | Embedded bundle only |
| Preview | Internal standalone APK | `https://api-staging.sugata.online/api/v1` | Embedded bundle only |
| Production | Signed Android App Bundle; remote version auto-increment | `https://api.sugata.online/api/v1` | Embedded bundle only |

The matrix applies to Driver, Passenger, and Admin. Development URLs may be overridden for controlled physical-device LAN testing. Preview and production configuration rejects missing URLs, URLs without `/api/v1`, HTTP, localhost, `127.0.0.1`, and the Android emulator loopback address.

`EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_API_URL`, and `SUGAT_ALLOW_HTTP` are public build configuration. They must never contain credentials, tokens, signing material, database URLs, JWT secrets, or Redis credentials. Production values may be supplied through reviewed EAS environment configuration, but only non-secret client values may use the `EXPO_PUBLIC_` prefix.

## Versioning and native safety

- `version` is the user-visible semantic application version and changes for planned releases.
- EAS remote app-version management and production `autoIncrement` advance Android `versionCode` for each production binary.
- Every code release requires a new build while OTA is disabled.
- Any Expo SDK, React Native, native-module, Android permission, foreground-service, background-task, package-identity, or native build configuration change requires a new signed binary and physical regression testing.
- If OTA is introduced later, it requires a separate reviewed change: install/configure `expo-updates`, assign unique project IDs, use a native-compatible runtime policy such as `fingerprint`, isolate preview/production channels, and prove cross-app/channel isolation before publishing.

## Android release verification

Automated validation covers resolved Expo configuration, Expo Doctor, TypeScript, Android bundle export, dependency integrity, and repository regression gates. It does not replace these physical checks:

### Driver

- Install a preview APK; sign in and complete forced-password change.
- Start a READY trip and verify foreground/background GPS, lock-screen operation, and the persistent foreground-service notification.
- Swipe the UI from recents, reopen it, and verify active-trip reconciliation without duplicate tracking.
- Queue locations offline, reconnect, and verify bounded ordered upload.
- Complete the trip and verify the task/notification stops.
- Restart the phone during and after a trip; record battery-optimization and OEM-specific behavior.

### Passenger

- Install without creating an account; deny location and confirm stop search and trip discovery still work.
- Search, open a tracked trip, inspect map and contextual ETA, then background/foreground the app.
- Verify reconnect and LIVE/STALE/OFFLINE transitions.

### Admin

- Install, authenticate as Admin, and verify the configured API environment.
- Create a schedule with the Asia/Manila contract and observe authorized realtime state.
- Log out and back in; verify Driver-only forced-password policy does not block Admin.

Record device model, Android version, artifact/build reference, API environment, and PASS/FAIL for every physical case. Google Play submission is a separate explicitly authorized operation.
