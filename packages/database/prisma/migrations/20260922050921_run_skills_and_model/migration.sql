-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "preferredModel" TEXT,
ADD COLUMN     "skillIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
