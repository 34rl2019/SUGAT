-- Existing accounts retain their current password lifecycle. New temporary
-- credentials are explicitly marked by the application after this migration.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
