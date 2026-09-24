# Pilot operations

Admin maintains official ordered routes/stops, registered vehicles and drivers,
and assigns vehicles to drivers. Each route record represents its existing
direction. Drivers start actual trips
from those choices, without a schedule or READY trip. Legacy schedules/history
remain available; schedule creation is unavailable in both the Admin UI and API.

## API and realtime contracts

- `GET /api/v1/driver/operations`: active trip, assigned active vehicles,
  active operating routes, and driver compliance.
- `POST /api/v1/driver/trips/start`: `{ routeId, vehicleId, startStopId, destinationStopId }`. Driver Mobile requires all four selections; the API retains single-assigned-vehicle
  resolution for compatible clients omitting vehicleId. Both endpoints are required,
  active, on the selected active operating route, in forward order, with boarding/dropoff permission. Creates ACTIVE with
  actual `startedAt`, null scheduled departure and VACANT occupancy. The STARTED
  event metadata stores both endpoints; Driver, Admin, Passenger, GPS and stop
  progression use that segment. No new Trip columns are required.
- `PATCH /api/v1/driver/trips/:id/occupancy`: `{ occupancyStatus: "VACANT" | "FULL" }`.
- Existing completion and GPS endpoints remain in use.
- `POST /api/v1/admin/drivers/:id/device/reset`: revokes the binding and all driver
  sessions. Active trips remain active so the replacement device can resume them.
- Public search includes vehicle ID, current location, timestamps, freshness policy,
  and nullable occupancy. Detail includes registered plate and optional conduction sticker.
- `/live` uses `trips.subscribe` with origin/destination; the server resolves all
  matching trip rooms. An optional validated `tripIds` list selects a subset.
  Existing `trip.subscribe` remains compatible for detail tracking.
- `trip.location.updated`, `trip.completed`, and new `trip.occupancy.updated`
  identify the trip. Occupancy includes vehicle ID, status, and `updatedAt`.
- Overview state reconciles over HTTP every 30 seconds and after reconnect;
  freshness ages every five seconds. Completed trips disappear immediately when
  their completion event arrives. New or no-longer-matching trips reconcile within
  the next successful HTTP refresh. FULL trips remain visible.

## Device credentials

The first successful driver login creates a random 256-bit bearer credential.
Only its SHA-256 hash is stored server-side. Driver Mobile stores the credential
in Expo SecureStore with device-only iOS accessibility. It survives logout.
Subsequent logins and refreshes supply `deviceCredential`; protected requests use
`x-sugat-device-credential` plus the access JWT. Each driver request checks the
current session, binding, account and driver state. Reset immediately invalidates
subsequent old-device requests, including GPS and occupancy.

This is possession-based device authorization, not hardware attestation. Protect
HTTPS and credential storage. If first-login delivery/storage fails after binding,
Admin can reset it. Device credentials must never be logged or shown to passengers.

## Safe rollout

1. Review and back up before applying
   `202609180001_pilot_operations` through the normal deployment migration process.
   Do not use database reset or `db push`.
2. The migration adds nullable occupancy fields and conduction sticker, driver route
   grants, device bindings and session references. It preserves all historical
   trips/schedules and active-trip unique indexes. It does not backfill VACANT or
   infer route authorization from old schedules.
3. Existing driver sessions are revoked by this migration. Coordinate API and Driver
   Mobile rollout: drivers must use the updated client and log in again. Drivers
   select from active operating routes when starting trips. Existing active trips can resume;
   their occupancy remains unknown until the driver explicitly updates it.
4. Regenerate Prisma Client and deploy only affected applications following
   `deploy/DEPLOYMENT.md`. No production migration or deployment is performed by
   local implementation checks.
5. Verify three real pilot vehicles, background GPS, reconnect, occupancy, device
   reset and physical plate comparison on actual devices before public pilot use.

Passenger maps use the existing OSM raster-tile approach. Configure appropriate
tile infrastructure before scaling beyond the pilot. Map route lines join known
stops and do not represent road routing. ETA retains the existing estimator.

## Validation

API Jest tests cover autonomous operations, device/session revocation, route grants,
public identity, occupancy, and overview subscriptions alongside existing GPS/ETA/
Redis-adapter tests. Passenger Web tests also exercise the shared Mobile/Web
overview state, reconnect, HTTP fallback, freshness and independent vehicle updates.
The existing Docker/PostGIS/Redis release gate remains the database/infrastructure
integration check; use its isolated E2E environment, never production credentials.
Executed checks and outstanding release gates are recorded in
[PILOT_VALIDATION.md](PILOT_VALIDATION.md).
