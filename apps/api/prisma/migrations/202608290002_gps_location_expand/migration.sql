-- EXPAND PHASE: compatible with both the legacy API (which continues to use
-- TripLocationHistory) and the new bounded-current-location API.
CREATE TYPE "GpsIngestionStatus" AS ENUM ('PROMOTED', 'REJECTED', 'STALE');

CREATE TABLE "GpsIngestionEvent" (
    "eventId" TEXT NOT NULL,
    "tripId" UUID NOT NULL,
    "status" "GpsIngestionStatus" NOT NULL,
    "rejectionReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GpsIngestionEvent_pkey" PRIMARY KEY ("eventId")
);

-- Retain only recent identifiers needed to make retries idempotent. Raw
-- coordinates stay in the legacy table until the separately approved contract.
INSERT INTO "GpsIngestionEvent" ("eventId", "tripId", "status", "rejectionReason", "receivedAt", "expiresAt")
SELECT "eventId", "tripId",
       CASE WHEN "suspicious" THEN 'REJECTED'::"GpsIngestionStatus" ELSE 'PROMOTED'::"GpsIngestionStatus" END,
       "rejectionReason", "receivedAt", "receivedAt" + INTERVAL '72 hours'
FROM "TripLocationHistory"
WHERE "receivedAt" >= CURRENT_TIMESTAMP - INTERVAL '72 hours';

CREATE INDEX "GpsIngestionEvent_tripId_receivedAt_idx" ON "GpsIngestionEvent"("tripId", "receivedAt");
CREATE INDEX "GpsIngestionEvent_expiresAt_idx" ON "GpsIngestionEvent"("expiresAt");
ALTER TABLE "GpsIngestionEvent" ADD CONSTRAINT "GpsIngestionEvent_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOT VALID avoids rejecting the expand deployment because of unknown legacy
-- rows while still enforcing the relationship for all new writes. Validation
-- is an explicit contract-phase action after the documented preflight queries.
ALTER TABLE "VehicleCurrentLocation" ADD CONSTRAINT "VehicleCurrentLocation_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- Do not drop TripLocationHistory here. The production API that precedes this
-- release still writes it during the expand/application deployment interval.
