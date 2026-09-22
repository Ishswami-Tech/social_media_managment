import { z } from "zod";
import { assertTransition, PLATFORMS, type PostStatus } from "@platform/types";
import { loadSocialCredential, type Prisma } from "@platform/database";
import type { ProviderContext } from "@platform/social-core";
import { ApiError, badRequest, conflict, notFound } from "../errors";
import { audit } from "../audit";
import { keyring, prisma } from "../db";
import { providers } from "../providers";
import { queues } from "../queue";
import type { OrgContext } from "../session";

export const variantInput = z.object({
  socialAccountId: z.string().min(1),
  text: z.string().max(65_000).optional(),
  mediaAssetIds: z.array(z.string()).max(20).default([]),
  platformOptions: z.record(z.string(), z.unknown()).optional(),
});

export const createPostInput = z.object({
  title: z.string().max(200).optional(),
  masterText: z.string().max(65_000),
  variants: z.array(variantInput).min(1).max(20),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().max(64).optional(),
  /** Approving the post schedules it automatically (at scheduledAt, or immediately when unset). */
  autoPublishOnApproval: z.boolean().default(false),
  tags: z.array(z.string().max(40)).max(20).default([]),
  sourceRef: z.string().max(200).optional(),
});
export type CreatePostInput = z.infer<typeof createPostInput>;

export const updatePostInput = createPostInput.partial();

const postInclude = {
  variants: {
    include: {
      socialAccount: {
        select: { id: true, platform: true, displayName: true, avatarUrl: true, status: true, requireApproval: true },
      },
      media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } },
      publishJobs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  },
  approvals: { include: { reviewer: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
  createdBy: { select: { id: true, name: true, image: true } },
} satisfies Prisma.PostInclude;

export type PostWithRelations = Prisma.PostGetPayload<{ include: typeof postInclude }>;

async function assertAccounts(organizationId: string, ids: string[]) {
  const accounts = await prisma.socialAccount.findMany({ where: { organizationId, id: { in: ids } } });
  if (accounts.length !== new Set(ids).size)
    throw badRequest("One or more social accounts do not belong to this organization");
  return accounts;
}

async function assertMedia(organizationId: string, ids: string[]) {
  if (ids.length === 0) return;
  const count = await prisma.mediaAsset.count({ where: { organizationId, id: { in: ids } } });
  if (count !== new Set(ids).size) throw badRequest("One or more media assets do not belong to this organization");
}

export async function getPost(ctx: OrgContext, postId: string): Promise<PostWithRelations> {
  const post = await prisma.post.findFirst({
    where: { id: postId, organizationId: ctx.organization.id },
    include: postInclude,
  });
  if (!post) throw notFound("Post");
  return post;
}

function assertCanEdit(ctx: OrgContext, post: { createdById: string }) {
  if (post.createdById !== ctx.user.id && !ctx.can("content:edit_any"))
    throw new ApiError(403, "You can only edit your own posts", "forbidden");
}

export async function createPost(ctx: OrgContext, input: CreatePostInput) {
  const accounts = await assertAccounts(
    ctx.organization.id,
    input.variants.map((v) => v.socialAccountId),
  );
  await assertMedia(
    ctx.organization.id,
    input.variants.flatMap((v) => v.mediaAssetIds),
  );
  const post = await prisma.post.create({
    data: {
      organizationId: ctx.organization.id,
      createdById: ctx.user.id,
      title: input.title,
      masterText: input.masterText,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      timezone: input.timezone ?? ctx.settings.timezone,
      autoPublishOnApproval: input.autoPublishOnApproval,
      tags: input.tags,
      sourceRef: input.sourceRef,
      approvalStatus: "NOT_REQUIRED",
      variants: {
        create: input.variants.map((v) => ({
          platform: accounts.find((a) => a.id === v.socialAccountId)!.platform,
          socialAccountId: v.socialAccountId,
          text: v.text ?? input.masterText,
          platformOptions: (v.platformOptions ?? {}) as object,
          media: { create: v.mediaAssetIds.map((mediaAssetId, i) => ({ mediaAssetId, sortOrder: i })) },
        })),
      },
    },
    include: postInclude,
  });
  await audit(ctx, "post.create", "Post", post.id, { variants: post.variants.length });
  return post;
}

export async function updatePost(ctx: OrgContext, postId: string, input: z.infer<typeof updatePostInput>) {
  const post = await getPost(ctx, postId);
  assertCanEdit(ctx, post);
  if (!["DRAFT", "IN_REVIEW", "FAILED", "CANCELLED", "DISCONNECTED_ACCOUNT"].includes(post.status))
    throw conflict(`Post cannot be edited while ${post.status}`);
  let variantOps: Prisma.PostUpdateInput["variants"] | undefined;
  if (input.variants) {
    const accounts = await assertAccounts(
      ctx.organization.id,
      input.variants.map((v) => v.socialAccountId),
    );
    await assertMedia(
      ctx.organization.id,
      input.variants.flatMap((v) => v.mediaAssetIds),
    );
    variantOps = {
      deleteMany: {},
      create: input.variants.map((v) => ({
        platform: accounts.find((a) => a.id === v.socialAccountId)!.platform,
        socialAccountId: v.socialAccountId,
        text: v.text ?? input.masterText ?? post.masterText,
        platformOptions: (v.platformOptions ?? {}) as object,
        media: { create: v.mediaAssetIds.map((mediaAssetId, i) => ({ mediaAssetId, sortOrder: i })) },
      })),
    };
  }
  const updated = await prisma.post.update({
    where: { id: postId },
    data: {
      title: input.title,
      masterText: input.masterText,
      scheduledAt: input.scheduledAt === undefined ? undefined : input.scheduledAt ? new Date(input.scheduledAt) : null,
      timezone: input.timezone,
      autoPublishOnApproval: input.autoPublishOnApproval,
      tags: input.tags,
      // Any edit invalidates a previous approval.
      status: post.status === "IN_REVIEW" ? "DRAFT" : post.status,
      approvalStatus:
        post.approvalStatus === "APPROVED" || post.approvalStatus === "PENDING" ? "NOT_REQUIRED" : post.approvalStatus,
      variants: variantOps,
    },
    include: postInclude,
  });
  await audit(ctx, "post.update", "Post", postId);
  return updated;
}

export async function deletePost(ctx: OrgContext, postId: string) {
  const post = await getPost(ctx, postId);
  if (post.createdById !== ctx.user.id && !ctx.can("content:delete"))
    throw new ApiError(403, "Not allowed to delete this post", "forbidden");
  if (["QUEUED", "PUBLISHING"].includes(post.status)) throw conflict("Cancel the post before deleting it");
  await prisma.post.delete({ where: { id: postId } });
  await audit(ctx, "post.delete", "Post", postId);
}

async function setStatus(postId: string, status: PostStatus, extra: Prisma.PostUpdateInput = {}) {
  return prisma.post.update({
    where: { id: postId },
    data: { status, ...extra, variants: { updateMany: { where: {}, data: { status } } } },
    include: postInclude,
  });
}

/** Does this post need approval? Org default, overridable per connected account. */
export function approvalRequired(ctx: OrgContext, post: PostWithRelations): boolean {
  return post.variants.some((v) => v.socialAccount.requireApproval ?? ctx.settings.requireApproval);
}

export async function submitForReview(ctx: OrgContext, postId: string) {
  const post = await getPost(ctx, postId);
  assertCanEdit(ctx, post);
  assertTransition(post.status, "IN_REVIEW");
  const updated = await setStatus(postId, "IN_REVIEW", { approvalStatus: "PENDING" });
  await audit(ctx, "post.submit", "Post", postId);
  return updated;
}

export async function reviewPost(ctx: OrgContext, postId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  const post = await getPost(ctx, postId);
  if (post.status !== "IN_REVIEW") throw conflict("Post is not awaiting review");
  if (post.createdById === ctx.user.id && ctx.role !== "OWNER" && ctx.role !== "ADMIN")
    throw new ApiError(403, "You cannot approve your own post", "forbidden");
  await prisma.postApproval.create({ data: { postId, reviewerId: ctx.user.id, decision, comment } });
  const updated =
    decision === "APPROVED"
      ? await setStatus(postId, "APPROVED", { approvalStatus: "APPROVED" })
      : await setStatus(postId, "DRAFT", { approvalStatus: "REJECTED" });
  await audit(ctx, decision === "APPROVED" ? "post.approve" : "post.reject", "Post", postId, { comment });
  if (decision === "APPROVED" && post.autoPublishOnApproval) {
    // The author asked for automatic publishing once approved; the approval is the
    // authorisation, so this runs regardless of the approver's own publish grant.
    const when = post.scheduledAt && post.scheduledAt.getTime() > Date.now() ? post.scheduledAt : new Date();
    const scheduled = await schedulePost(ctx, postId, when.toISOString(), post.timezone);
    await audit(ctx, "post.auto_schedule", "Post", postId, { scheduledAt: when.toISOString() });
    return scheduled;
  }
  return updated;
}

/** Schedule (or reschedule) a post: creates one idempotent PublishJob per variant and enqueues it. */
export async function schedulePost(ctx: OrgContext, postId: string, scheduledAtIso: string, timezone?: string) {
  const post = await getPost(ctx, postId);
  const scheduledAt = new Date(scheduledAtIso);
  if (Number.isNaN(scheduledAt.getTime())) throw badRequest("Invalid scheduledAt");
  if (approvalRequired(ctx, post) && post.approvalStatus !== "APPROVED")
    throw conflict("Post must be approved before scheduling");
  if (!approvalRequired(ctx, post) && post.status === "DRAFT") {
    // no approval workflow for these accounts: DRAFT -> APPROVED implicitly
    await setStatus(postId, "APPROVED", { approvalStatus: "NOT_REQUIRED" });
    post.status = "APPROVED";
  }
  assertTransition(post.status, "SCHEDULED");
  const disconnected = post.variants.filter((v) => v.socialAccount.status !== "CONNECTED");
  if (disconnected.length)
    throw conflict(`Reconnect ${disconnected.map((v) => v.socialAccount.displayName).join(", ")} before scheduling`);

  await prisma.$transaction(async (tx) => {
    // Cancel any existing pending jobs for a reschedule.
    await tx.publishJob.updateMany({
      where: { postVariant: { postId }, status: { in: ["PENDING", "QUEUED"] } },
      data: { status: "CANCELLED" },
    });
    for (const v of post.variants) {
      await tx.publishJob.create({
        data: {
          postVariantId: v.id,
          idempotencyKey: `${v.id}:${scheduledAt.toISOString()}`,
          scheduledAt,
          status: "PENDING",
        },
      });
    }
    await tx.post.update({
      where: { id: postId },
      data: {
        status: "SCHEDULED",
        scheduledAt,
        timezone: timezone ?? post.timezone,
        variants: { updateMany: { where: {}, data: { status: "SCHEDULED" } } },
      },
    });
  });
  await enqueuePostJobs(ctx.organization.id, postId);
  await audit(ctx, "post.schedule", "Post", postId, { scheduledAt: scheduledAt.toISOString() });
  return getPost(ctx, postId);
}

export async function publishNow(ctx: OrgContext, postId: string) {
  return schedulePost(ctx, postId, new Date().toISOString());
}

/**
 * System-initiated scheduling (no request context): used by the Agent Council
 * once a recommendation has been approved through its own approval flow. The
 * post must already be APPROVED; it is scheduled through exactly the same
 * PublishJob + queue path as `schedulePost`. Returns the post id.
 */
export async function scheduleApprovedPostSystem(
  organizationId: string,
  postId: string,
  scheduledAt: Date,
): Promise<{ postId: string; jobCount: number }> {
  if (Number.isNaN(scheduledAt.getTime())) throw badRequest("Invalid scheduledAt");
  const post = await prisma.post.findFirst({ where: { id: postId, organizationId }, include: postInclude });
  if (!post) throw notFound("Post");
  if (post.approvalStatus !== "APPROVED") throw conflict("Post must be approved before scheduling");
  assertTransition(post.status, "SCHEDULED");
  const disconnected = post.variants.filter((v) => v.socialAccount.status !== "CONNECTED");
  if (disconnected.length)
    throw conflict(`Reconnect ${disconnected.map((v) => v.socialAccount.displayName).join(", ")} before scheduling`);
  await prisma.$transaction(async (tx) => {
    await tx.publishJob.updateMany({
      where: { postVariant: { postId }, status: { in: ["PENDING", "QUEUED"] } },
      data: { status: "CANCELLED" },
    });
    for (const v of post.variants) {
      await tx.publishJob.create({
        data: {
          postVariantId: v.id,
          idempotencyKey: `${v.id}:${scheduledAt.toISOString()}`,
          scheduledAt,
          status: "PENDING",
        },
      });
    }
    await tx.post.update({
      where: { id: postId },
      data: { status: "SCHEDULED", scheduledAt, variants: { updateMany: { where: {}, data: { status: "SCHEDULED" } } } },
    });
  });
  await enqueuePostJobs(organizationId, postId);
  return { postId, jobCount: post.variants.length };
}

async function enqueuePostJobs(organizationId: string, postId: string) {
  const jobs = await prisma.publishJob.findMany({ where: { postVariant: { postId }, status: "PENDING" } });
  for (const job of jobs) {
    const delayMs = Math.max(0, job.scheduledAt.getTime() - Date.now());
    const queued = await queues().enqueue(
      "publish",
      job.idempotencyKey,
      { publishJobId: job.id, postVariantId: job.postVariantId, organizationId },
      { delayMs },
    );
    await prisma.publishJob.update({
      where: { id: job.id },
      data: { status: "QUEUED", queueJobId: queued.id ?? job.idempotencyKey },
    });
  }
  await prisma.post.update({
    where: { id: postId },
    data: {
      status: "QUEUED",
      variants: { updateMany: { where: { status: "SCHEDULED" }, data: { status: "QUEUED" } } },
    },
  });
}

export async function cancelPost(ctx: OrgContext, postId: string) {
  const post = await getPost(ctx, postId);
  assertCanEdit(ctx, post);
  assertTransition(post.status, "CANCELLED");
  const jobs = await prisma.publishJob.findMany({
    where: { postVariant: { postId }, status: { in: ["PENDING", "QUEUED"] } },
  });
  for (const job of jobs) await queues().remove("publish", job.idempotencyKey);
  await prisma.publishJob.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { status: "CANCELLED" } });
  const updated = await setStatus(postId, "CANCELLED");
  await audit(ctx, "post.cancel", "Post", postId);
  return updated;
}

/**
 * Removes a published post from every platform it went to (where the provider
 * API allows it), then marks the post DELETED. Variants that were never
 * published are left untouched. Each removal is audited.
 */
export async function unpublishPost(ctx: OrgContext, postId: string) {
  const post = await getPost(ctx, postId);
  assertTransition(post.status, "DELETED");
  const removed: { platform: string; externalPostId: string }[] = [];
  const failures: string[] = [];
  for (const variant of post.variants) {
    if (variant.status !== "PUBLISHED" || !variant.externalPostId) continue;
    const provider = providers().get(variant.platform);
    if (!provider.deletePost) {
      failures.push(`${variant.platform} does not support deleting posts through its API`);
      continue;
    }
    const credential = await loadSocialCredential(prisma, keyring(), variant.socialAccountId);
    if (!credential) {
      failures.push(`${variant.socialAccount.displayName}: no stored credential`);
      continue;
    }
    const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: variant.socialAccountId } });
    const providerCtx: ProviderContext = {
      credential,
      externalAccountId: account.externalAccountId,
      accountType: account.accountType,
      metadata: (account.metadata as Record<string, unknown>) ?? undefined,
    };
    try {
      await provider.deletePost(variant.externalPostId, providerCtx);
      await prisma.postVariant.update({ where: { id: variant.id }, data: { status: "DELETED" } });
      removed.push({ platform: variant.platform, externalPostId: variant.externalPostId });
    } catch (e) {
      failures.push(`${variant.socialAccount.displayName}: ${(e as Error).message}`);
    }
  }
  if (removed.length === 0 && failures.length > 0) throw conflict(failures.join("; "));
  const updated = await prisma.post.update({ where: { id: postId }, data: { status: "DELETED" }, include: postInclude });
  await audit(ctx, "post.unpublish", "Post", postId, { removed, failures });
  return { post: updated, removed, failures };
}

export interface PostHistoryEvent {
  id: string;
  at: Date;
  action: string;
  actor: string | null;
  detail: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  "post.create": "Created",
  "post.update": "Edited",
  "post.submit": "Submitted for approval",
  "post.approve": "Approved",
  "post.reject": "Rejected",
  "post.auto_schedule": "Auto-scheduled after approval",
  "post.schedule": "Scheduled",
  "post.cancel": "Cancelled",
  "post.unpublish": "Removed from platform",
  "post.delete": "Deleted",
};

function describe(action: string, metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  if (typeof m.comment === "string" && m.comment) return m.comment;
  if (typeof m.scheduledAt === "string") return `for ${new Date(m.scheduledAt).toLocaleString()}`;
  if (action === "post.unpublish") {
    const removed = Array.isArray(m.removed) ? (m.removed as { platform: string }[]).map((r) => r.platform) : [];
    const failures = Array.isArray(m.failures) ? (m.failures as string[]) : [];
    return [removed.length ? `removed from ${removed.join(", ")}` : null, ...failures].filter(Boolean).join("; ") || null;
  }
  return null;
}

/**
 * Chronological timeline of everything that happened to a post: audited
 * actions (create, edit, review, schedule, cancel, removal) merged with every
 * publish attempt the worker made.
 */
export async function postHistory(ctx: OrgContext, postId: string): Promise<PostHistoryEvent[]> {
  const [logs, attempts] = await Promise.all([
    prisma.auditLog.findMany({
      where: { organizationId: ctx.organization.id, resourceType: "Post", resourceId: postId },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.publishAttempt.findMany({
      where: { publishJob: { postVariant: { postId } } },
      include: { publishJob: { include: { postVariant: { select: { platform: true } } } } },
      orderBy: { startedAt: "asc" },
    }),
  ]);
  const fromLogs: PostHistoryEvent[] = logs.map((l) => ({
    id: l.id,
    at: l.createdAt,
    action: ACTION_LABELS[l.action] ?? l.action,
    actor: l.actor?.name ?? null,
    detail: describe(l.action, l.metadata),
  }));
  const fromAttempts: PostHistoryEvent[] = attempts
    .filter((a) => a.status !== "RUNNING")
    .map((a) => ({
      id: a.id,
      at: a.finishedAt ?? a.startedAt,
      action:
        a.status === "SUCCEEDED"
          ? `Published to ${a.publishJob.postVariant.platform}`
          : `Publish to ${a.publishJob.postVariant.platform} failed`,
      actor: null,
      detail: a.status === "SUCCEEDED" ? null : (a.error ?? a.errorCode ?? null),
    }));
  return [...fromLogs, ...fromAttempts].sort((x, y) => x.at.getTime() - y.at.getTime());
}

export async function listPosts(
  ctx: OrgContext,
  opts: {
    /** A single status, or a group of statuses shown under one filter. */
    status?: PostStatus | PostStatus[];
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
    mine?: boolean;
  },
) {
  const statusFilter = Array.isArray(opts.status) ? { in: opts.status } : opts.status;
  const where: Prisma.PostWhereInput = {
    organizationId: ctx.organization.id,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(opts.mine ? { createdById: ctx.user.id } : {}),
    ...(opts.from || opts.to ? { scheduledAt: { gte: opts.from, lte: opts.to } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.post.findMany({
      where,
      include: postInclude,
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.post.count({ where }),
  ]);
  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

export const PLATFORM_SET = new Set<string>(PLATFORMS);
