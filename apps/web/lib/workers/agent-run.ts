/**
 * BullMQ processor for the Agent Council pipeline.
 *
 * The worker owns nothing but orchestration: it builds the tenant-scoped
 * `PipelineContext`, advances the pure pipeline stage by stage until it says it
 * is done, then applies the *application's* publishing policy to decide whether
 * the run needs a human (AWAITING_APPROVAL) or may be applied straight away
 * (APPROVED). An LLM never reaches a social API — publishing still goes through
 * `applyApprovedRun` and the deterministic Post → PublishJob path.
 *
 * Failure handling mirrors the state machine in `@platform/types`:
 *   - `PipelineBlocked`  → BLOCKED with a reason, no retry (a human resumes it).
 *   - anything else      → FAILED; BullMQ retries, and the final attempt parks
 *                          the job on the dead-letter queue for an admin.
 */
import { advanceRun, decideNextAfterAdapting, isPipelineBlocked } from "@platform/agent-council";
import { parkDeadLetter, type AgentRunJobData } from "@platform/queue";
import { can, DEFAULT_OVERRIDES, type OrgPermissionOverrides } from "@platform/rbac";
import type { AgentPublishMode, AgentRunStatus, OrgRole } from "@platform/types";
import type { Job } from "bullmq";
import { isOrgRole } from "@/lib/auth-access";
import { buildPipelineContext } from "@/lib/agent/context";
import { createPrismaRunStore } from "@/lib/agent/store";
import { applyApprovedRun } from "@/lib/agent/apply";
import { generateRunMedia } from "@/lib/agent/media";
import { notifyAwaitingApproval } from "@/lib/agent/tokens";
import { prisma } from "@/lib/db";
import { errorInfo, logger } from "@/lib/logger";
import { queues } from "@/lib/queue";

/**
 * Hard stop on the advance loop. The pipeline has six stages; anything beyond
 * this means a stage is not progressing and we would spin forever.
 */
const MAX_ADVANCE_STEPS = 32;

/** Statuses for which a queued job is a no-op (a human or an earlier job already settled the run). */
const SKIP_STATUSES: ReadonlySet<AgentRunStatus> = new Set<AgentRunStatus>([
  "PAUSED",
  "CANCELLED",
  "COMPLETED",
  "PUBLISHING",
]);

const runLogger = logger.child({ worker: "agent-run" });
type RunLogger = ReturnType<typeof logger.child>;

// ---------------------------------------------------------------------------
// Publishing policy (spec: "Automatic publishing policy — all must hold")
// ---------------------------------------------------------------------------

/**
 * Everything `decideNextAfterAdapting` needs. Field names mirror
 * `PublishPolicy` in `@platform/agent-council`; declared here so this module
 * stays readable and unit-testable on its own.
 */
export interface PublishPolicyInput {
  /** The run's own mode, chosen at creation time. */
  publishMode: AgentPublishMode;
  /** `OrganizationSettings.agentPublishMode` */
  orgMode: AgentPublishMode;
  /** The user who created the run still holds `content:publish`. */
  creatorCanPublish: boolean;
  /** `SocialAccount.agentAutoPublish` for each target account, in run order. */
  accountsAutoPublish: boolean[];
  /** Every account came out of ADAPTING with a final text (no stage silently dropped one). */
  checksPassed: boolean;
  /** The run stayed within its own cap. */
  budgetOk: boolean;
}

/**
 * Resolve the creator's `content:publish` capability the same way
 * `getOrgContext` does (role matrix + the organization's permission overrides),
 * but without a session: the worker acts as the creator, never as a super admin.
 */
export async function creatorCanPublish(organizationId: string, userId: string): Promise<boolean> {
  const [member, settings] = await Promise.all([
    prisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true, status: true },
    }),
    prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { permissionOverrides: true },
    }),
  ]);
  if (!member || member.status === "SUSPENDED") return false;
  const role: OrgRole | undefined = isOrgRole(member.role) ? member.role : undefined;
  const overrides = (settings?.permissionOverrides as OrgPermissionOverrides | null) ?? DEFAULT_OVERRIDES;
  return can({ userId, isSuperAdmin: false, role }, "content:publish", { overrides });
}

async function buildPolicy(runId: string, organizationId: string): Promise<PublishPolicyInput> {
  const run = await prisma.agentRun.findFirst({
    where: { id: runId, organizationId },
    select: {
      createdById: true,
      publishMode: true,
      maxCents: true,
      spentCents: true,
      accounts: { select: { finalText: true, socialAccount: { select: { agentAutoPublish: true } } } },
    },
  });
  if (!run) throw new Error(`Agent run ${runId} not found in organization`);
  const [settings, canPublish] = await Promise.all([
    prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { agentPublishMode: true },
    }),
    creatorCanPublish(organizationId, run.createdById),
  ]);
  return {
    publishMode: run.publishMode,
    orgMode: settings?.agentPublishMode ?? "APPROVAL_REQUIRED",
    creatorCanPublish: canPublish,
    accountsAutoPublish: run.accounts.map((a) => a.socialAccount.agentAutoPublish),
    checksPassed: run.accounts.length > 0 && run.accounts.every((a) => a.finalText !== null && a.finalText !== ""),
    budgetOk: run.spentCents <= run.maxCents,
  };
}

// ---------------------------------------------------------------------------
// Job guards
// ---------------------------------------------------------------------------

type RunHeader = { id: string; status: AgentRunStatus };

/**
 * Whether this job should do any work at all. A run can be paused, cancelled or
 * already finished between enqueue and pickup; BLOCKED and FAILED runs only move
 * again when a human explicitly resumed/retried them (`resume` on the job).
 */
export function shouldSkipRun(status: AgentRunStatus, resume: boolean): string | undefined {
  if (SKIP_STATUSES.has(status)) return `run is ${status}`;
  if (status === "BLOCKED" && !resume) return "run is BLOCKED and the job is not a resume";
  if (status === "FAILED" && !resume) return "run is FAILED and the job is not a retry";
  return undefined;
}

async function loadRunHeader(runId: string, organizationId: string): Promise<RunHeader | null> {
  return prisma.agentRun.findFirst({ where: { id: runId, organizationId }, select: { id: true, status: true } });
}

/** Status changes during teardown must never mask the original failure. */
async function setStatusSafely(
  runId: string,
  status: AgentRunStatus,
  extra: { error?: string; blockedReason?: string },
): Promise<void> {
  try {
    await createPrismaRunStore().setStatus(runId, status, extra);
  } catch (e) {
    runLogger.warn("could not record terminal status", { runId, status, ...errorInfo(e) });
  }
}

async function park(job: Job<AgentRunJobData>, message: string): Promise<void> {
  try {
    await parkDeadLetter(queues(), {
      queue: "agent-run",
      originalJobId: String(job.id ?? job.data.runId),
      data: job.data,
      error: message,
      attempts: job.attemptsMade + 1,
      failedAt: new Date().toISOString(),
    });
  } catch (e) {
    runLogger.error("could not park agent run on the dead-letter queue", { runId: job.data.runId, ...errorInfo(e) });
  }
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function runAgentRunJob(job: Job<AgentRunJobData>): Promise<void> {
  const { runId, organizationId } = job.data;
  // BullMQ's own retries arrive with attemptsMade > 0 and must be honoured like a human retry.
  const resume = job.data.resume === true || job.attemptsMade > 0;
  const log = logger.child({ worker: "agent-run", runId, organizationId, jobId: job.id });

  const header = await loadRunHeader(runId, organizationId);
  if (!header) {
    log.warn("agent run not found for organization; dropping job");
    return;
  }
  const skip = shouldSkipRun(header.status, resume);
  if (skip) {
    log.info("skipping agent run job", { reason: skip, status: header.status });
    return;
  }

  try {
    const ctx = await buildPipelineContext(organizationId, runId);
    for (let step = 0; step < MAX_ADVANCE_STEPS; step++) {
      const result = await advanceRun(ctx, runId);
      if (result.done) break;
      if (step === MAX_ADVANCE_STEPS - 1) {
        throw new Error(`Agent run ${runId} did not finish within ${MAX_ADVANCE_STEPS} stage advances`);
      }
    }
    await settleAfterPipeline(runId, organizationId, ctx.store.setStatus.bind(ctx.store), log);
  } catch (error) {
    const { message } = errorInfo(error);
    if (isPipelineBlocked(error)) {
      log.info("agent run blocked; waiting for a human", { reason: message });
      await setStatusSafely(runId, "BLOCKED", { blockedReason: message.slice(0, 500) });
      return; // Blocked runs are resumed explicitly: never retry.
    }
    log.error("agent run failed", { ...errorInfo(error) });
    await setStatusSafely(runId, "FAILED", { error: message.slice(0, 500) });
    await recordAttempt(runId, job.attemptsMade + 1);
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await park(job, message);
    throw error; // Let BullMQ apply the backoff and retry policy.
  }
}

type SetStatus = (
  runId: string,
  status: AgentRunStatus,
  extra?: { currentStep?: string; error?: string; blockedReason?: string },
) => Promise<void>;

/**
 * The pipeline stops at ADAPTING: the decision to auto-publish is the
 * application's, not the model's. Everything else the pipeline already settled
 * (BLOCKED, or a run a human paused mid-flight) is left untouched.
 */
async function settleAfterPipeline(
  runId: string,
  organizationId: string,
  setStatus: SetStatus,
  log: RunLogger,
): Promise<void> {
  const header = await loadRunHeader(runId, organizationId);
  if (!header || header.status !== "ADAPTING") {
    log.debug("pipeline finished outside ADAPTING; nothing to settle", { status: header?.status });
    return;
  }
  const policy = await buildPolicy(runId, organizationId);
  if (!policy.checksPassed) {
    // Every account must carry a recommendation before a human is asked to approve anything.
    await setStatus(runId, "FAILED", { error: "The AI did not finish a post for every account. Try again." });
    log.warn("agent run finished without a recommendation for every account");
    return;
  }
  const media = await generateRunMedia(runId, organizationId);
  if (media.generated + media.failed > 0) log.info("images for the recommendations", media);
  const next = decideNextAfterAdapting(policy);
  log.info("agent run left the pipeline", { next });

  if (next === "APPROVED") {
    await setStatus(runId, "APPROVED");
    await applyApprovedRun(runId);
    return;
  }
  // MANUAL runs stop at a recommendation. ADAPTING has no direct edge to
  // COMPLETED in AGENT_RUN_TRANSITIONS, so the run passes through
  // AWAITING_APPROVAL (which is also what the UI reads) before closing.
  await setStatus(runId, "AWAITING_APPROVAL");
  if (next === "COMPLETED") {
    await setStatus(runId, "COMPLETED");
    return;
  }
  const notified = await notifyAwaitingApproval(runId);
  log.info("approval requested", { ...notified });
}

/** Mirrors the BullMQ attempt counter onto the run so the UI can show it without Redis. */
async function recordAttempt(runId: string, attempt: number): Promise<void> {
  try {
    await prisma.agentRun.update({ where: { id: runId }, data: { attempt } });
  } catch (e) {
    runLogger.warn("could not record run attempt", { runId, ...errorInfo(e) });
  }
}
