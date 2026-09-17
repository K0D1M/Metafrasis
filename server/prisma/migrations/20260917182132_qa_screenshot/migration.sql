-- AlterTable
ALTER TABLE "QaReport" ADD COLUMN     "screenshotStoredName" TEXT,
ADD COLUMN     "screenshotOriginalName" TEXT,
ADD COLUMN     "screenshotMimeType" TEXT,
ADD COLUMN     "screenshotSizeBytes" INTEGER;
