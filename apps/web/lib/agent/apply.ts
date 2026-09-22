/**
 * Apply an approved Agent Council run: create ONE Post (with a PostVariant per
 * approved account) and schedule it through the existing PublishJob path.
 * This is the only bridge between the AI layer and publishing; the pipeline
 * itself never touches Post rows or providers.
 *
 * Idempotent: accounts that already carry a `postId` are skipped, and a run
 * whose approved accounts are all applied is completed without side effects.
 */
import { loadSocialCredential } from "@platform/database";
import { assertRunTransition, type AgentRunStatus } from "@platform/types";
import { keyring, prisma } from "../db";
import { logger, errorInfo } from "../logger";
import { scheduleApprovedPostSystem } from "../services/posts";

export interface ApplyResult {
  status: AgentRunStatus;
  postId: string | null;
  /** Reason when the run was blocked instead of applied. */
  blockedReason?: string;
}

const PLATFORM_NAMES: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  X: "X",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  THREADS: "Threads",
  PINTEREST: "Pinterest",
};

/** Final text with hashtags appended when the text does not already contain them. */
export function composeFinalText(text: string, hashtags: readonly string[]): string {
  const body = text.trimEnd();
  const lower = body.toLowerCase();
  const missing = hashtags
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .filter((h) => h.length > 1 && !lower.includes(h.toLowerCase()));
  return missing.length ? `${body}\n\n${missing.join(" ")}` : body;
}

async function setRunStatus(
  runId: string,
  from: AgentRunStatus,
  to: AgentRunStatus,
  extra: { blockedReason?: string | null; resumeStatus?: AgentRunStatus | null; completedAt?: Date | null } = {},
) {
  assertRunTransition(from, to);
  await prisma.agentRun.update({ where: { id: runId }, data: { status: to, currentStep: to.toLowerCase(), ...extra } });
}

async function addEvent(
  runId: string,
  step: string,
  status: "STARTED" | "SUCCEEDED" | "FAILED" | "SKIPPED",
  extra: { output?: object; error?: string } = {},
) {
  await prisma.agentRunEvent.create({
    data: { runId, step, status, output: extra.output, error: extra.error },
  });
}

async function finishExistingPost(
  runId: string,
  organizationId: string,
  postId: string,
  runScheduledAt: Date | null,
): Promise<ApplyResult> {
  await setRunStatus(runId, "APPROVED", "PUBLISHING");
  try {
    const post = await prisma.post.findFirst({ where: { id: postId, organizationId }, select: { status: true } });
    if (post && post.status === "APPROVED") {
      const when = runScheduledAt && runScheduledAt.getTime() > Date.now() ? runScheduledAt : new Date();
      await scheduleApprovedPostSystem(organizationId, postId, when);
    }
    await setRunStatus(runId, "PUBLISHING", "COMPLETED", { completedAt: new Date(), blockedReason: null });
    return { status: "COMPLETED", postId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Publishing could not be scheduled";
    await addEvent(runId, "publish", "FAILED", { error: message.slice(0, 1000) });
    await setRunStatus(runId, "PUBLISHING", "BLOCKED", { blockedReason: message.slice(0, 1000), resumeStatus: "APPROVED" });
    return { status: "BLOCKED", postId, blockedReason: message };
  }
}

/**
 * Create the post and schedule it. Called by the decision flow (after every
 * account has been decided) and by the worker when the policy allows
 * AUTOMATIC publishing (run status APPROVED). Safe to call again.
 */
export async function applyApprovedRun(runId: string): Promise<ApplyResult> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: { accounts: { include: { socialAccount: true } } },
  });
  if (!run) throw new Error(`Agent run ${runId} not found`);
  if (run.status !== "APPROVED") {
    return { status: run.status, postId: run.accounts.find((a) => a.postId)?.postId ?? null };
  }
  const approved = run.accounts.filter((a) => a.decision === "APPROVED");
  const alreadyApplied = approved.find((a) => a.postId);
  if (alreadyApplied?.postId) {
    // A previous attempt created the post; schedule it if that step failed, then finish.
    return finishExistingPost(run.id, run.organizationId, alreadyApplied.postId, run.scheduledAt);
  }
  if (approved.length === 0) {
    await addEvent(runId, "publish", "SKIPPED", { output: { reason: "no approved accounts" } });
    await setRunStatus(runId, "APPROVED", "BLOCKED", {
      blockedReason: "No account was approved for publishing",
      resumeStatus: "APPROVED",
    });
    return { status: "BLOCKED", postId: null, blockedReason: "No account was approved for publishing" };
  }

  // Re-validate every target before touching the publisher path.
  const problems: string[] = [];
  for (const a of approved) {
    const name = `${PLATFORM_NAMES[a.platform] ?? a.platform} account ${a.socialAccount.displayName}`;
    if (a.socialAccount.status !== "CONNECTED") {
      problems.push(`${name} is ${a.socialAccount.status.toLowerCase()}; reconnect it`);
      continue;
    }
    const credential = await loadSocialCredential(prisma, keyring(), a.socialAccountId);
    if (!credential) problems.push(`${name} has no stored token; reconnect it`);
    else if (credential.expiresAt && credential.expiresAt.getTime() < Date.now())
      problems.push(`${PLATFORM_NAMES[a.platform] ?? a.platform} token expired for ${a.socialAccount.displayName}`);
    if (!a.finalText && !a.editedText) problems.push(`${name} has no final text`);
  }
  if (problems.length) {
    const blockedReason = problems.join("; ").slice(0, 1000);
    await addEvent(runId, "publish", "FAILED", { error: blockedReason });
    await setRunStatus(runId, "APPROVED", "BLOCKED", { blockedReason, resumeStatus: "APPROVED" });
    return { status: "BLOCKED", postId: null, blockedReason };
  }

  await setRunStatus(runId, "APPROVED", "PUBLISHING");
  await addEvent(runId, "publish", "STARTED", { output: { accounts: approved.map((a) => a.socialAccountId) } });
  try {
    const mediaIds = [...new Set(approved.flatMap((a) => a.mediaAssetIds))];
    const ownedMedia = mediaIds.length
      ? await prisma.mediaAsset.findMany({
          where: { id: { in: mediaIds }, organizationId: run.organizationId, status: "READY" },
          select: { id: true },
        })
      : [];
    const owned = new Set(ownedMedia.map((m) => m.id));
    const scheduledAt = run.scheduledAt && run.scheduledAt.getTime() > Date.now() ? run.scheduledAt : new Date();
    const first = approved[0]!;
    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          organizationId: run.organizationId,
          createdById: run.createdById,
          title: run.topic.slice(0, 200),
          masterText: composeFinalText(first.editedText ?? first.finalText ?? "", first.finalHashtags),
          status: "APPROVED",
          approvalStatus: "APPROVED",
          autoPublishOnApproval: true,
          scheduledAt,
          timezone: run.timezone,
          sourceRef: `agent-run:${run.id}`,
          tags: ["agent-council"],
          variants: {
            create: approved.map((a) => ({
              platform: a.platform,
              socialAccountId: a.socialAccountId,
              status: "APPROVED",
              text: composeFinalText(a.editedText ?? a.finalText ?? "", a.finalHashtags),
              platformOptions: {},
              media: {
                create: a.mediaAssetIds
                  .filter((id) => owned.has(id))
                  .map((mediaAssetId, i) => ({ mediaAssetId, sortOrder: i })),
              },
            })),
          },
        },
        select: { id: true },
      });
      for (const a of approved) {
        await tx.agentRunAccount.update({ where: { id: a.id }, data: { postId: created.id, error: null } });
      }
      return created;
    });
    const scheduled = await scheduleApprovedPostSystem(run.organizationId, post.id, scheduledAt);
    await addEvent(runId, "publish", "SUCCEEDED", {
      output: { postId: post.id, jobs: scheduled.jobCount, scheduledAt: scheduledAt.toISOString() },
    });
    await setRunStatus(runId, "PUBLISHING", "COMPLETED", { completedAt: new Date(), blockedReason: null });
    return { status: "COMPLETED", postId: post.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Publishing could not be scheduled";
    logger.error("agent run apply failed", { runId, ...errorInfo(e) });
    await addEvent(runId, "publish", "FAILED", { error: message.slice(0, 1000) });
    await setRunStatus(runId, "PUBLISHING", "BLOCKED", {
      blockedReason: message.slice(0, 1000),
      resumeStatus: "APPROVED",
    });
    return { status: "BLOCKED", postId: null, blockedReason: message };
  }
}
