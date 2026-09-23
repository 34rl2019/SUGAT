-- CONTRACT PHASE — DO NOT RUN WITH `prisma migrate deploy` DURING EXPAND.
-- Execute only after the compatible application has been deployed, observed,
-- and the read-only preflight in deploy/DEPLOYMENT.md returns zero problems.
-- Back up PostgreSQL immediately before this destructive operation.

ALTER TABLE "VehicleCurrentLocation"
  VALIDATE CONSTRAINT "VehicleCurrentLocation_vehicleId_fkey";

DROP TABLE "TripLocationHistory";

-- After production verification, promote this reviewed SQL into the next
-- timestamped Prisma migration so Prisma records the contract operation.
