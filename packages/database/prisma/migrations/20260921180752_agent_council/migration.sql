-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RESEARCHING', 'STRATEGIZING', 'DRAFTING', 'REVIEWING', 'JUDGING', 'ADAPTING', 'AWAITING_APPROVAL', 'APPROVED', 'PUBLISHING', 'COMPLETED', 'FAILED', 'PAUSED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentAssurance" AS ENUM ('JUDGE_ONLY', 'HIGH_ASSURANCE');

-- CreateEnum
CREATE TYPE "AgentPublishMode" AS ENUM ('MANUAL', 'APPROVAL_REQUIRED', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "AgentDraftRole" AS ENUM ('WRITER', 'REVISION', 'SYNTHESIS', 'ADAPTATION');

-- CreateEnum
CREATE TYPE "AgentEventStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AgentAccountDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('SUPPORTED', 'UNSUPPORTED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "BudgetReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED');

-- CreateEnum
CREATE TYPE "CircuitState" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "agentAllowedModels" JSONB,
ADD COLUMN     "agentAssurance" "AgentAssurance" NOT NULL DEFAULT 'JUDGE_ONLY',
ADD COLUMN     "agentMaxActiveRuns" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "agentMonthlyBudgetCents" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "agentPublishMode" "AgentPublishMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED',
ADD COLUMN     "agentRunMaxCents" INTEGER NOT NULL DEFAULT 200;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "agentAutoPublish" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "audience" TEXT,
    "notes" TEXT,
    "platforms" "Platform"[],
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "assurance" "AgentAssurance" NOT NULL DEFAULT 'JUDGE_ONLY',
    "publishMode" "AgentPublishMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED',
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "maxCents" INTEGER NOT NULL DEFAULT 200,
    "spentCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "resumeStatus" "AgentRunStatus",
    "blockedReason" TEXT,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "researchBriefId" TEXT,
    "research" JSONB,
    "promptVersions" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunAccount" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "strategy" JSONB,
    "winnerDraftId" TEXT,
    "finalText" TEXT,
    "finalHashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mediaConcept" TEXT,
    "mediaAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decision" "AgentAccountDecision" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "editedText" TEXT,
    "postId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRunAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDraft" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "runAccountId" TEXT NOT NULL,
    "role" "AgentDraftRole" NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "promptHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "claimIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checks" JSONB,
    "judgeScore" DOUBLE PRECISION,
    "judgeRationale" TEXT,
    "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" "AgentEventStatus" NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "promptKey" TEXT,
    "promptVersion" INTEGER,
    "promptHash" TEXT,
    "input" JSONB,
    "output" JSONB,
    "validation" JSONB,
    "costCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApprovalToken" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApprovalToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "evidence" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "identity" JSONB,
    "audience" JSONB,
    "voice" JSONB,
    "content" JSONB,
    "performance" JSONB,
    "humanFeedback" JSONB,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "learnedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostFeatures" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "postVariantId" TEXT NOT NULL,
    "hookType" TEXT,
    "format" TEXT,
    "ctaType" TEXT,
    "topic" TEXT,
    "length" INTEGER NOT NULL DEFAULT 0,
    "hashtagCount" INTEGER NOT NULL DEFAULT 0,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "postedHourUtc" INTEGER,
    "postedWeekday" INTEGER,
    "impressions" INTEGER,
    "engagements" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "publishedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "learnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostFeatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT,
    "cents" INTEGER NOT NULL,
    "actualCents" DOUBLE PRECISION,
    "status" "BudgetReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "BudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderHealth" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" "CircuitState" NOT NULL DEFAULT 'CLOSED',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "openedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderHealth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_status_idx" ON "AgentRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_createdAt_idx" ON "AgentRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRunAccount_socialAccountId_idx" ON "AgentRunAccount"("socialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunAccount_runId_socialAccountId_key" ON "AgentRunAccount"("runId", "socialAccountId");

-- CreateIndex
CREATE INDEX "AgentDraft_runAccountId_idx" ON "AgentDraft"("runAccountId");

-- CreateIndex
CREATE INDEX "AgentRunEvent_runId_createdAt_idx" ON "AgentRunEvent"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApprovalToken_tokenHash_key" ON "AgentApprovalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentApprovalToken_runId_idx" ON "AgentApprovalToken"("runId");

-- CreateIndex
CREATE INDEX "Claim_runId_idx" ON "Claim"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountProfile_socialAccountId_key" ON "AccountProfile"("socialAccountId");

-- CreateIndex
CREATE INDEX "AccountProfile_organizationId_idx" ON "AccountProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PostFeatures_postVariantId_key" ON "PostFeatures"("postVariantId");

-- CreateIndex
CREATE INDEX "PostFeatures_socialAccountId_publishedAt_idx" ON "PostFeatures"("socialAccountId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_hash_key" ON "PromptVersion"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_key_version_key" ON "PromptVersion"("key", "version");

-- CreateIndex
CREATE INDEX "BudgetReservation_organizationId_status_createdAt_idx" ON "BudgetReservation"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderHealth_provider_key" ON "ProviderHealth"("provider");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunAccount" ADD CONSTRAINT "AgentRunAccount_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunAccount" ADD CONSTRAINT "AgentRunAccount_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDraft" ADD CONSTRAINT "AgentDraft_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDraft" ADD CONSTRAINT "AgentDraft_runAccountId_fkey" FOREIGN KEY ("runAccountId") REFERENCES "AgentRunAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunEvent" ADD CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalToken" ADD CONSTRAINT "AgentApprovalToken_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountProfile" ADD CONSTRAINT "AccountProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountProfile" ADD CONSTRAINT "AccountProfile_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostFeatures" ADD CONSTRAINT "PostFeatures_postVariantId_fkey" FOREIGN KEY ("postVariantId") REFERENCES "PostVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
