-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "audience" TEXT,
    "platforms" "Platform"[],
    "startDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPlan_organizationId_createdAt_idx" ON "ContentPlan"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
