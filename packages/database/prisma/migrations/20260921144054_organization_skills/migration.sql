-- CreateTable
CREATE TABLE "OrganizationSkill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationSkill_organizationId_enabled_idx" ON "OrganizationSkill"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSkill_organizationId_slug_key" ON "OrganizationSkill"("organizationId", "slug");

-- AddForeignKey
ALTER TABLE "OrganizationSkill" ADD CONSTRAINT "OrganizationSkill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
