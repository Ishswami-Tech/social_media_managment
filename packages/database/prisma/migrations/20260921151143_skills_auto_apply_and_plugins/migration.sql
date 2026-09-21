-- CreateEnum
CREATE TYPE "PluginKind" AS ENUM ('MCP', 'HTTP');

-- AlterTable
ALTER TABLE "OrganizationSkill" ADD COLUMN     "autoApply" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrganizationPlugin" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "PluginKind" NOT NULL,
    "url" TEXT NOT NULL,
    "headersEncrypted" TEXT,
    "inputSchema" JSONB,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationPlugin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationPlugin_organizationId_enabled_idx" ON "OrganizationPlugin"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationPlugin_organizationId_slug_key" ON "OrganizationPlugin"("organizationId", "slug");

-- AddForeignKey
ALTER TABLE "OrganizationPlugin" ADD CONSTRAINT "OrganizationPlugin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
