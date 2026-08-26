# SUGAT

**AYAW HULAT. SUGATA.**

SUGAT is a free community platform that makes legitimate long-distance buses and vans visible to passengers along an ordered route. Passengers never create an account: they select a boarding stop and destination, view matching active trips, and watch the vehicle location update live.

## Architecture

- `apps/api`: NestJS, Prisma, PostgreSQL/PostGIS, Socket.IO
- `apps/passenger-web`: responsive public React/Vite experience; recommended primary passenger channel because it has the lowest adoption friction
- `apps/passenger-mobile`: optional React Native public client foundation
- `apps/driver-mobile`: Expo Android/iOS Driver App with background GPS, secure sessions, and offline synchronization
- `packages`: shared domain types and utilities

The driver remains a native mobile app because reliable foreground-service/background GPS cannot be guaranteed by an ordinary browser. The responsive Admin Web consumes the protected operational API.

## Core workflow

1. Admin signs in and creates a driver, assigned vehicle, stops, ordered route, and one-time schedule.
2. Schedule creation creates a `READY` trip after checking driver/vehicle assignment conflicts.
3. Driver signs in, retrieves `GET /api/v1/driver/assignment`, and starts only that assigned trip.
4. Android location collection queues idempotent events locally and syncs them to the active trip.
5. Public users call `/api/v1/public/stops`, search by ordered stop IDs, and subscribe to the selected trip's Socket.IO room.
6. Completion removes current public location immediately and retains history/audit records.

## Local setup

1. Copy `.env.example` to `.env`; replace both JWT secrets.
2. Run `docker compose up postgres redis -d`.
3. Run `corepack enable && pnpm install`.
4. Apply the checked-in migration with `corepack pnpm --filter @sugat/api prisma migrate deploy`.
5. Run `NODE_ENV=development pnpm db:seed` to create only an admin login; it creates no fake vehicles, trips, schedules, or GPS.
6. Run `pnpm dev`.

## API groups

- Public: `GET /public/stops`, `/public/routes`, `/public/trips/search`, `/public/trips/:id`, `/public/trips/:id/location`
- Driver: `GET /driver/assignment`, `POST /driver/trips/:id/start|locations|locations/batch|complete`
- Admin: dashboard, drivers, vehicles, stops, routes, schedules, and live operations under `/admin`
- Authentication: staff/driver login and rotating refresh sessions under `/auth`; there is deliberately no public registration endpoint

## Database migration safety

`202608260001_final_sugat_domain` is the complete initial SUGAT schema: authentication, drivers, vehicles, stops, routes, schedules, trips, current/history locations, events, sessions, audits, foreign keys, indexes, PostGIS, and GiST geography indexes. It is intended for a database where this migration has never previously been applied. If an earlier partial copy was applied anywhere, reconcile its migration history before deployment. Never use `db push` in production.

## Remaining pilot work

- Complete physical end-to-end validation of the Admin configuration workflow against the deployed PostGIS database and mobile Driver App.
- Complete physical Android/iOS field validation of the implemented Driver App.
- Render a real MapLibre base map; current live web detail displays real coordinates and realtime movement on a map-status surface.
- Connect Redis' Socket.IO adapter for multiple API replicas and add a scheduled stale-event worker.
- Add production signing, store assets, and field-device battery/vendor testing.
- Add endpoint-level integration tests against PostGIS/Redis and operational metrics exporters.

No booking, passenger identity, payments, tickets, chat, ratings, operator portal, or ride matching is present.

## Production deployment

The isolated Hostinger/Ubuntu VPS runbook, PM2 process definition, Nginx sites, PostgreSQL/PostGIS setup, Redis isolation, HTTPS, safe update sequence, and verification commands are in [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md).

## Driver iPhone development build

`apps/driver-mobile` is an Expo SDK 52 application prepared for EAS cloud builds. A Mac is not required for EAS Build. Expo Go cannot test iOS background location; use the custom development build.

Before building, choose an iOS bundle identifier owned by you or your organization and create `apps/driver-mobile/.env` from its `.env.example`:

```bash
cd apps/driver-mobile
cp .env.example .env
```

Set:

- `SUGAT_IOS_BUNDLE_ID` to your permanent reverse-domain identifier. Do not ship the example value.
- `EXPO_PUBLIC_API_URL` to an HTTPS API reachable by the iPhone, including `/api/v1`. `localhost` on the iPhone is the iPhone itself, not this laptop.

For same-network development, an address such as `http://192.168.1.50:3000/api/v1` can be used temporarily if iOS transport policy permits the development build, but HTTPS through a tunnel or deployed test API is recommended. The backend must listen on `0.0.0.0`, and firewall access must be allowed.

Then:

```bash
corepack pnpm install
cd apps/driver-mobile
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile development
```

Open the EAS installation link on the registered iPhone. A paid Apple Developer Program membership is required for ad hoc installation on a physical iPhone from a non-Mac machine. After installation, start Metro when using the development profile:

```bash
EXPO_PUBLIC_API_URL=https://your-api.example/api/v1 \
SUGAT_IOS_BUNDLE_ID=your.permanent.bundle.id \
npx expo start --dev-client --tunnel
```

On iPhone, grant location access and select **Always** in Settings when prompted. iOS background tracking can operate while minimized, locked, or while another app is open, but not after the user force-quits SUGAT Driver. Validate all cases on the physical device before field use.

## Driver Android field build

Android is the primary field-test platform. The Expo configuration generates `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, and `POST_NOTIFICATIONS`. SUGAT displays a persistent foreground-service notification while an active trip is tracked.

Create `apps/driver-mobile/.env` and set an Android package name you control:

```dotenv
SUGAT_ANDROID_PACKAGE=ph.yourorganization.sugat.driver
EXPO_PUBLIC_API_URL=https://your-api.example/api/v1
SUGAT_ALLOW_HTTP=false
```

### Simplest free APK: EAS cloud preview

An Expo account is required, but neither a Google Play account nor paid signing membership is required for an internal Android APK:

```bash
cd /home/stephen/Documents/SYSTEMS/SUGAT_APP/apps/driver-mobile
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
```

Set the three build environment values in the EAS project before building. When the build finishes, open its installation URL on the Android phone, allow installation from that browser when prompted, and install the APK. The `preview` profile is standalone and does not need Metro.

For a development-client APK instead:

```bash
npx eas-cli@latest build --platform android --profile development
npx expo start --dev-client --tunnel
```

### Free local USB build

This requires JDK 17, Android Studio/SDK, platform tools, USB debugging, and a connected device:

```bash
cd /home/stephen/Documents/SYSTEMS/SUGAT_APP/apps/driver-mobile
npx expo run:android --device
```

To create a local debug APK without immediately installing it:

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleDebug
```

The APK is produced at `apps/driver-mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Install it with:

```bash
adb install -r apps/driver-mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

### Backend connectivity

- LAN: set `EXPO_PUBLIC_API_URL=http://LAPTOP_LAN_IP:3000/api/v1` and `SUGAT_ALLOW_HTTP=true` **before generating/building the native app**. Start the API on `0.0.0.0` and permit TCP port 3000 through the laptop firewall. Both devices must be on the same network.
- HTTPS tunnel: expose laptop port 3000 through a trusted tunnel, use its HTTPS URL plus `/api/v1`, and keep `SUGAT_ALLOW_HTTP=false`.
- Deployed API: use the deployed HTTPS API URL; this is the most representative field setup.

On Android, grant precise location, choose **Allow all the time**, and allow notifications. Confirm the persistent SUGAT tracking notification appears after START TRIP. Some manufacturers aggressively stop background apps; disable battery optimization for SUGAT Driver during the field test and record the phone model/Android version.
