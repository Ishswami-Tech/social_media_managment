import { loadSocialCredential, saveSocialCredential } from "@platform/database";
import { decideRetry } from "@platform/queue";
import {
  isDisconnectError,
  isRetryable,
  needsRefresh,
  ProviderError,
  type NormalizedMedia,
  type NormalizedPost,
  type ProviderContext,
} from "@platform/social-core";
import type { MediaKind } from "@platform/types";
import { keyring, prisma } from "../db";
import { logger, errorInfo } from "../logger";
import { providers } from "../providers";
import { queues } from "../queue";
import { storage } from "../storage";

/**
 * Executes one PublishJob (spec §15). Called by the publish worker.
 *
 * Idempotency: the job row is the source of truth. A job that already
 * SUCCEEDED or was CANCELLED is a no-op, and an attempt that reached the
 * provider is recorded before we touch the network so a crash between
 * "published" and "saved" never republishes: the next run sees the RUNNING
 * attempt and reconciles via getPublishStatus instead of publishing again.
 */
export async function runPublishJob(publishJobId: string): Promise<void> {
  const log = logger.child({ publishJobId });
  const job = await prisma.publishJob.findUnique({
    where: { id: publishJobId },
    include: {
      postVariant: {
        include: {
          post: true,
          socialAccount: true,
          media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!job) return log.warn("publish job missing");
  if (job.status === "SUCCEEDED" || job.status === "CANCELLED" || job.status === "FAILED")
    return log.info("publish job already terminal", { status: job.status });
  const variant = job.postVariant;
  const account = variant.socialAccount;

  // Claim before any provider call. A cancelled calendar revision can remain
  // in Redis, but must never publish after a concurrent reschedule.
  if (job.status === "PENDING" || job.status === "QUEUED") {
    const claimed = await prisma.publishJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "RUNNING" },
    });
    if (!claimed.count) return log.info("publish revision was cancelled or claimed");
  }

  // Reconcile a previous attempt that may have published before crashing.
  const dangling = await prisma.publishAttempt.findFirst({
    where: { publishJobId, status: "RUNNING" },
    orderBy: { attemptNumber: "desc" },
  });
  if (dangling?.externalPostId) {
    await markSucceeded(job.id, variant.id, variant.postId, dangling.externalPostId, null, dangling.id);
    return;
  }
  if (dangling)
    await prisma.publishAttempt.update({
      where: { id: dangling.id },
      data: { status: "FAILED", finishedAt: new Date(), error: "Interrupted before completion" },
    });

  const attemptNumber = job.attemptCount + 1;
  const attempt = await prisma.publishAttempt.create({ data: { publishJobId, attemptNumber, status: "RUNNING" } });
  await prisma.publishJob.update({ where: { id: job.id }, data: { status: "RUNNING", attemptCount: attemptNumber } });
  await prisma.postVariant.update({ where: { id: variant.id }, data: { status: "PUBLISHING" } });
  await prisma.post.update({ where: { id: variant.postId }, data: { status: "PUBLISHING" } });
  const started = Date.now();

  try {
    if (account.status !== "CONNECTED")
      throw new ProviderError("Account is not connected", "ACCOUNT_DISCONNECTED", false);
    const provider = providers().get(account.platform);
    let credential = await loadSocialCredential(prisma, keyring(), account.id);
    if (!credential) throw new ProviderError("No stored credential", "ACCOUNT_DISCONNECTED", false);

    const ctx: ProviderContext = {
      credential,
      externalAccountId: account.externalAccountId,
      accountType: account.accountType,
      metadata: (account.metadata as Record<string, unknown>) ?? undefined,
    };
    if (needsRefresh(credential.expiresAt)) {
      log.info("refreshing token", { platform: account.platform });
      const refreshed = await provider.refreshToken(ctx);
      await saveSocialCredential(prisma, keyring(), account.id, { ...refreshed, metadata: refreshed.secretMetadata });
      credential = { ...credential, ...refreshed };
      ctx.credential = credential;
    }

    const media: NormalizedMedia[] = [];
    for (const pm of variant.media) {
      const a = pm.mediaAsset;
      if (a.status !== "READY" && a.status !== "UPLOADED")
        throw new ProviderError(`Media ${a.fileName} is not ready`, "INVALID_MEDIA", false);
      const variants = (a.variants as Record<string, string> | null) ?? {};
      const platformKey = Object.entries(variants).find(([k]) => k.startsWith(account.platform.toLowerCase()))?.[1];
      const key = platformKey ?? a.storageKey;
      media.push({
        id: a.id,
        kind: a.kind as MediaKind,
        mimeType: platformKey ? "image/jpeg" : a.mimeType,
        size: a.size,
        width: a.width ?? undefined,
        height: a.height ?? undefined,
        duration: a.duration ?? undefined,
        url: storage().publicUrl(key) ?? (await storage().signedDownloadUrl(key, 3600)),
        fetchBuffer: () => storage().getObject(key),
        altText: a.altText ?? undefined,
      });
    }
    const post: NormalizedPost = {
      idempotencyKey: job.idempotencyKey,
      text: variant.text,
      media,
      platformOptions: (variant.platformOptions as Record<string, unknown>) ?? undefined,
    };
    const validation = await provider.validatePost(post, ctx);
    if (!validation.ok)
      throw new ProviderError(
        validation.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.message)
          .join("; "),
        "INVALID_CONTENT",
        false,
      );

    const result = await provider.publish(post, ctx);
    await markSucceeded(
      job.id,
      variant.id,
      variant.postId,
      result.externalPostId,
      result.externalUrl ?? null,
      attempt.id,
      Date.now() - started,
    );
    log.info("published", { platform: account.platform, externalPostId: result.externalPostId });
  } catch (e) {
    const err = e as Error;
    const code = e instanceof ProviderError ? e.code : "UNKNOWN";
    const retryable = isRetryable(e);
    const disconnected = isDisconnectError(e);
    log.warn("publish attempt failed", { ...errorInfo(e), attemptNumber, retryable });
    await prisma.publishAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: err.message.slice(0, 2000),
        errorCode: code,
        retryable,
        durationMs: Date.now() - started,
      },
    });

    if (disconnected) {
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: "EXPIRED", lastError: err.message.slice(0, 500) },
      });
      await prisma.publishJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: err.message.slice(0, 2000) },
      });
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: { status: "DISCONNECTED_ACCOUNT", lastError: err.message.slice(0, 2000) },
      });
      await rollupPostStatus(variant.postId);
      return;
    }
    const decision = decideRetry({
      attempt: attemptNumber,
      maxAttempts: job.maxAttempts,
      retryable,
      retryAfterMs: e instanceof ProviderError ? e.retryAfterMs : undefined,
    });
    if (decision.retry) {
      const nextAttemptAt = new Date(Date.now() + decision.delayMs);
      await prisma.publishJob.update({
        where: { id: job.id },
        data: { status: "QUEUED", nextAttemptAt, lastError: err.message.slice(0, 2000) },
      });
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: { status: "RETRYING", lastError: err.message.slice(0, 2000) },
      });
      await prisma.post.update({ where: { id: variant.postId }, data: { status: "RETRYING" } });
      await queues().enqueue(
        "publish",
        `${job.idempotencyKey}:retry${attemptNumber}`,
        { publishJobId: job.id, postVariantId: variant.id, organizationId: variant.post.organizationId },
        { delayMs: decision.delayMs },
      );
    } else {
      await prisma.publishJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: err.message.slice(0, 2000) },
      });
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: { status: "FAILED", lastError: err.message.slice(0, 2000) },
      });
      await rollupPostStatus(variant.postId);
    }
  }
}

async function markSucceeded(
  jobId: string,
  variantId: string,
  postId: string,
  externalPostId: string,
  externalUrl: string | null,
  attemptId: string,
  durationMs?: number,
) {
  const now = new Date();
  await prisma.$transaction([
    prisma.publishAttempt.update({
      where: { id: attemptId },
      data: { status: "SUCCEEDED", finishedAt: now, externalPostId, durationMs },
    }),
    prisma.publishJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", lastError: null } }),
    prisma.postVariant.update({
      where: { id: variantId },
      data: { status: "PUBLISHED", externalPostId, externalUrl, publishedAt: now, lastError: null },
    }),
  ]);
  await rollupPostStatus(postId);
}

/** Post status = aggregate of its variants. */
export async function rollupPostStatus(postId: string) {
  const variants = await prisma.postVariant.findMany({
    where: { postId },
    select: { status: true, publishedAt: true },
  });
  const statuses = new Set(variants.map((v) => v.status));
  let status: (typeof variants)[number]["status"];
  if (statuses.size === 1) status = variants[0]!.status;
  else if (statuses.has("PUBLISHING") || statuses.has("RETRYING") || statuses.has("QUEUED")) status = "PUBLISHING";
  else if (statuses.has("PUBLISHED") && (statuses.has("FAILED") || statuses.has("DISCONNECTED_ACCOUNT")))
    status = "FAILED";
  else if (statuses.has("FAILED")) status = "FAILED";
  else if (statuses.has("DISCONNECTED_ACCOUNT")) status = "DISCONNECTED_ACCOUNT";
  else status = "PUBLISHED";
  const publishedAt =
    status === "PUBLISHED"
      ? (variants
          .map((v) => v.publishedAt)
          .filter(Boolean)
          .sort()
          .pop() ?? new Date())
      : undefined;
  await prisma.post.update({ where: { id: postId }, data: { status, publishedAt } });
}
