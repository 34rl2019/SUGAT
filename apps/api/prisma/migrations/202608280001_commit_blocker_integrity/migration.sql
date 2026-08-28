-- Database-enforced single-active-trip invariants. Partial indexes are the
-- PostgreSQL primitive required because Prisma cannot express partial uniques.
CREATE UNIQUE INDEX "trips_one_active_per_driver"
  ON "trips" ("driverId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "trips_one_active_per_vehicle"
  ON "trips" ("vehicleId") WHERE "status" = 'ACTIVE';

CREATE TYPE "VerificationDocumentType" AS ENUM ('LICENSE_FRONT', 'LICENSE_BACK', 'SELFIE');

CREATE TABLE "DriverVerificationSubmission" (
  "id" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "rejectionReason" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" UUID,
  CONSTRAINT "DriverVerificationSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverVerificationSubmission_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DriverVerificationSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "DriverVerificationDocument" (
  "id" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "type" "VerificationDocumentType" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverVerificationDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverVerificationDocument_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "DriverVerificationSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DriverVerificationSubmission_driverId_submittedAt_idx" ON "DriverVerificationSubmission"("driverId", "submittedAt");
CREATE INDEX "DriverVerificationSubmission_status_submittedAt_idx" ON "DriverVerificationSubmission"("status", "submittedAt");
CREATE UNIQUE INDEX "DriverVerificationDocument_storageKey_key" ON "DriverVerificationDocument"("storageKey");
CREATE UNIQUE INDEX "DriverVerificationDocument_submissionId_type_key" ON "DriverVerificationDocument"("submissionId", "type");
