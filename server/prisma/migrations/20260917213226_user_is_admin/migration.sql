-- AlterTable
-- Το deactivatedAt υπάρχει ήδη στη ζωντανή βάση (προηγούμενη προσθήκη εκτός migration
-- ιστορικού) — εδώ μόνο η νέα στήλη isAdmin.
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
