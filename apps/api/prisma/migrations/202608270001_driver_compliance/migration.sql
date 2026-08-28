CREATE TYPE "VerificationStatus" AS ENUM (
  'UNVERIFIED',
  'PENDING_VERIFICATION',
  'APPROVED',
  'REJECTED',
  'PENDING_REVERIFICATION'
);

ALTER TABLE "Driver"
  ADD COLUMN "identityVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "licenseVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

CREATE INDEX "Driver_identityVerificationStatus_idx" ON "Driver"("identityVerificationStatus");
CREATE INDEX "Driver_licenseVerificationStatus_idx" ON "Driver"("licenseVerificationStatus");
