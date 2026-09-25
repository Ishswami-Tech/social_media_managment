import { loadSocialCredential, saveSocialCredential } from "@platform/database";
import type { MaintenanceJobData } from "@platform/queue";
import { needsRefresh } from "@platform/social-core";
import { keyring, prisma } from "@/lib/db";
import { logger, errorInfo } from "@/lib/logger";
import { providers } from "@/lib/providers";
import { queues } from "@/lib/queue";
import { scheduleAnalyticsCollection } from "@/lib/services/analytics";
import { learnAllAccountProfiles } from "@/lib/agent/learning";
import { providerHealthSummary } from "@/lib/agent/provider-health";
import { isWorkerStatus, requeueRunBySystem, resumeRunBySystem } from "@/lib/agent/runs";
import { AGENT_PIPELINE } from "@platform/types";

/** Register repeatable housekeeping jobs (idempotent: BullMQ dedupes by repeat key). */
export async function scheduleMaintenance() {
  const q = queues().get("maintenance");
  await q.upsertJobScheduler(
    "refresh-tokens",
    { every: 15 * 60_000 },
    { name: "maintenance", data: { task: "refresh-tokens" } },
  );
  await q.upsertJobScheduler(
    "expire-oauth-states",
    { every: 60 * 60_000 },
    { name: "maintenance", data: { task: "expire-oauth-states" } },
  );
  await q.upsertJobScheduler(
    "retry-stuck-jobs",
    { every: 5 * 60_000 },
    { name: "maintenance", data: { task: "retry-stuck-jobs" } },
  );
  await q.upsertJobScheduler(
    "revive-runs",
    { every: 5 * 60_000 },
    { name: "maintenance", data: { task: "revive-runs" } },
  );
  await q.upsertJobScheduler(
    "collect-analytics",
    { every: 6 * 60 * 60_000 },
    { name: "maintenance", data: { task: "collect-analytics" } },
  );
  await q.upsertJobScheduler(
    "learn-account-profiles",
    { every: 24 * 60 * 60_000 },
    { name: "maintenance", data: { task: "learn-account-profiles" } },
  );
}

export async function runMaintenance(data: MaintenanceJobData) {
  switch (data.task) {
    case "refresh-tokens":
      return refreshExpiringTokens();
    case "expire-oauth-states":
      await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      return;
    case "retry-stuck-jobs":
      return requeueStuckJobs();
    case "revive-runs":
      return reviveRuns();
    case "collect-analytics": {
      const n = await scheduleAnalyticsCollection();
      logger.info("analytics collection scheduled", n);
      return;
    }
    case "learn-account-profiles": {
      const result = await learnAllAccountProfiles();
      logger.info("account profiles learned", result);
      return;
    }
  }
}

/** A run blocked for want of a provider, or one that stopped moving, is set going again once it can be. */
const PROVIDER_TROUBLE = /providers unavailable|quota|credits|usage limit|rate limit|overloaded/i;
const BLOCKED_GRACE_MS = 3 * 60_000;
const STUCK_AFTER_MS = 20 * 60_000;

async function reviveRuns(): Promise<void> {
  const health = await providerHealthSummary();
  const someProviderOpen = health.length === 0 || health.some((h) => !h.open);
  if (someProviderOpen) {
    const blocked = await prisma.agentRun.findMany({
      where: { status: "BLOCKED", updatedAt: { lt: new Date(Date.now() - BLOCKED_GRACE_MS) } },
      select: { id: true, blockedReason: true },
    });
    for (const run of blocked) {
      if (!PROVIDER_TROUBLE.test(run.blockedReason ?? "")) continue;
      if (await resumeRunBySystem(run.id, "a provider is available again")) logger.info("blocked run resumed", { runId: run.id });
    }
  }
  const stuck = await prisma.agentRun.findMany({
    where: { status: { in: [...AGENT_PIPELINE] }, updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    select: { id: true, status: true },
  });
  for (const run of stuck) {
    if (!isWorkerStatus(run.status)) continue;
    if (await requeueRunBySystem(run.id, "no progress for 20 minutes")) logger.warn("stalled run requeued", { runId: run.id, status: run.status });
  }
}

/** Proactively refresh tokens expiring within the next hour so scheduled posts don't fail at publish time. */
async function refreshExpiringTokens() {
  const soon = new Date(Date.now() + 60 * 60_000);
  const creds = await prisma.socialCredential.findMany({
    where: { expiresAt: { lte: soon }, socialAccount: { status: "CONNECTED" } },
    include: { socialAccount: true },
  });
  for (const c of creds) {
    const account = c.socialAccount;
    if (!providers().has(account.platform)) continue;
    try {
      const credential = await loadSocialCredential(prisma, keyring(), account.id);
      if (!credential || !needsRefresh(credential.expiresAt, 60 * 60_000)) continue;
      const refreshed = await providers()
        .get(account.platform)
        .refreshToken({ credential, externalAccountId: account.externalAccountId, accountType: account.accountType });
      await saveSocialCredential(prisma, keyring(), account.id, { ...refreshed, metadata: refreshed.secretMetadata });
      logger.info("token refreshed", { socialAccountId: account.id, platform: account.platform });
    } catch (e) {
      logger.warn("token refresh failed", { socialAccountId: account.id, ...errorInfo(e) });
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: "EXPIRED", lastError: (e as Error).message.slice(0, 500) },
      });
    }
  }
}

/** Jobs that were QUEUED but whose Redis job vanished (Redis flush, deploy) are re-enqueued from the database. */
async function requeueStuckJobs() {
  const stale = await prisma.publishJob.findMany({
    where: { status: "QUEUED", scheduledAt: { lt: new Date(Date.now() - 2 * 60_000) } },
    include: { postVariant: { include: { post: { select: { organizationId: true } } } } },
  });
  for (const job of stale) {
    const existing = await queues().getJob("publish", job.idempotencyKey);
    if (existing) continue;
    await queues().enqueue("publish", `${job.idempotencyKey}:requeue${Date.now()}`, {
      publishJobId: job.id,
      postVariantId: job.postVariantId,
      organizationId: job.postVariant.post.organizationId,
    });
    logger.info("requeued stuck publish job", { publishJobId: job.id });
  }
}
