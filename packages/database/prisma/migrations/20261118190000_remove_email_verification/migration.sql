UPDATE "User" SET "status" = 'ACTIVE' WHERE "status" = 'PENDING';

ALTER TABLE "User"
  DROP COLUMN "emailVerifiedAt",
  DROP COLUMN "emailVerificationCodeHash",
  DROP COLUMN "emailVerificationExpiresAt",
  DROP COLUMN "emailVerificationSentAt";