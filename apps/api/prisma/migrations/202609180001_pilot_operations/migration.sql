-- Additive pilot migration. Existing trips retain unknown occupancy (NULL).
-- No historical schedules, trips, locations, or identity records are removed.
CREATE TYPE "OccupancyStatus" AS ENUM ('VACANT', 'FULL');
ALTER TABLE "trips" ADD COLUMN "occupancyStatus" "OccupancyStatus",
  ADD COLUMN "occupancyUpdatedAt" TIMESTAMP(3),
  ALTER COLUMN "scheduledDepartureAt" DROP NOT NULL;
ALTER TABLE "Vehicle" ADD COLUMN "conductionSticker" TEXT;
CREATE TABLE "DriverRouteAuthorization" (
  "driverId" UUID NOT NULL REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "routeId" UUID NOT NULL REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY ("driverId", "routeId")
);
CREATE INDEX "DriverRouteAuthorization_routeId_idx" ON "DriverRouteAuthorization"("routeId");
-- Authorizations must be explicitly reviewed by Admin; historical schedules do not grant access.
CREATE TABLE "DriverDevice" (
  "id" UUID NOT NULL PRIMARY KEY,
  "driverId" UUID NOT NULL UNIQUE REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "credentialHash" TEXT NOT NULL,
  "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "RefreshSession" ADD COLUMN "driverDeviceId" UUID;
-- Existing driver sessions have no device binding and must log in again.
UPDATE "RefreshSession" SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL AND "userId" IN (SELECT "userId" FROM "Driver");
