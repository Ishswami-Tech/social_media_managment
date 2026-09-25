-- AlterTable
ALTER TABLE "ContentPlan" ADD COLUMN     "name" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';
