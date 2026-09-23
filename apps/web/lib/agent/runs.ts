/**
 * Agent Council run lifecycle for the web layer: create, list, inspect,
 * pause/resume/cancel/retry and per-account human decisions. Every query is
 * scoped by organizationId; every status change goes through
 * `assertRunTransition`; every human action is audited.
 */
import { z } from "zod";
import { can, type Capability, type OrgPermissionOverrides } from "@platform/rbac";
import type { Prisma } from "@platform/database";
import {
  AGENT_ASSURANCE_LEVELS,
  AGENT_PIPELINE,
  AGENT_PUBLISH_MODES,
  AGENT_RUN_STATUSES,
  assertRunTransition,
  type AgentPublishMode,
  type AgentRunStatus,
  type OrgRole,
} from "@platform/types";
import { ApiError, badRequest, conflict, notFound } from "../errors";
import { audit, auditPlatform } from "../audit";
import { prisma } from "../db";
import { AGENT_RUN_JOB_OPTIONS } from "@platform/queue";
import { queues } from "../queue";
import type { OrgContext } from "../session";
import { applyApprovedRun } from "./apply";
import { recordHumanEdit } from "./learning";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

export const createRunInput = z.object({
  topic: z.string().trim().min(3).max(500),
  goal: z.string().trim().min(3).max(500),
  audience: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  socialAccountIds: z.array(z.string().min(1)).min(1).max(10),
  /** Skills to attach: their instructions are appended to every writing prompt. */
  skillIds: z.array(z.string().min(1).max(120)).max(8).optional(),
  /** "PROVIDER::model" the person picked; omitted means automatic routing. */
  model: z
    .string()
    .trim()
    .max(200)
    .regex(/^[A-Z0-9_]+::.+$/, "Model must look like PROVIDER::model")
    .optional(),
  assurance: z.enum(AGENT_ASSURANCE_LEVELS).optional(),
  /** Generate an image from each account's media concept once the text is final. */
  image: z.boolean().optional(),
  publishMode: z.enum(AGENT_PUBLISH_MODES).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().max(64).optional(),
  maxCents: z.number().int().min(1).max(100_000).optional(),
});
export type CreateRunInput = z.infer<typeof createRunInput>;

export const listRunsQuery = z.object({
  status: z.enum(AGENT_RUN_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const decideInput = z.object({
  accountIds: z.array(z.string().min(1)).min(1).max(10),
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(2000).optional(),
  /** Only meaningful for a single account; the approver's edited final text. */
  editedText: z.string().max(65_000).optional(),
});
export type DecideInput = z.infer<typeof decideInput>;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const runListInclude = {
  accounts: {
    select: {
      id: true,
      socialAccountId: true,
      platform: true,
      decision: true,
      postId: true,
      socialAccount: { select: { displayName: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.AgentRunInclude;

const runDetailInclude = {
  accounts: {
    orderBy: { createdAt: "asc" },
    include: {
      socialAccount: {
        select: { id: true, platform: true, displayName: true, avatarUrl: true, status: true, agentAutoPublish: true },
      },
      drafts: { orderBy: [{ role: "asc" }, { label: "asc" }] },
    },
  },
  events: { orderBy: { createdAt: "asc" } },
  claims: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.AgentRunInclude;

export type AgentRunListItem = Prisma.AgentRunGetPayload<{ include: typeof runListInclude }>;
export type AgentRunDetail = Prisma.AgentRunGetPayload<{ include: typeof runDetailInclude }>;

/** Statuses that count against `agentMaxActiveRuns` (the worker is, or will be, busy). */
const ACTIVE_STATUSES: readonly AgentRunStatus[] = ["QUEUED", ...AGENT_PIPELINE, "APPROVED", "PUBLISHING"];

/** Statuses the worker must be re-enqueued for after a resume/retry. */
const WORKER_STATUSES: ReadonlySet<AgentRunStatus> = new Set<AgentRunStatus>(["QUEUED", ...AGENT_PIPELINE]);

interface AgentSettings {
  agentPublishMode: AgentPublishMode;
  agentAssurance: "JUDGE_ONLY" | "HIGH_ASSURANCE";
  agentRunMaxCents: number;
  agentMaxActiveRuns: number;
  timezone: string;
}

async function loadAgentSettings(organizationId: string): Promise<AgentSettings> {
  const s = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: {
      agentPublishMode: true,
      agentAssurance: true,
      agentRunMaxCents: true,
      agentMaxActiveRuns: true,
      timezone: true,
    },
  });
  return {
    agentPublishMode: s?.agentPublishMode ?? "APPROVAL_REQUIRED",
    agentAssurance: s?.agentAssurance ?? "JUDGE_ONLY",
    agentRunMaxCents: s?.agentRunMaxCents ?? 200,
    agentMaxActiveRuns: s?.agentMaxActiveRuns ?? 5,
    timezone: s?.timezone ?? "UTC",
  };
}

async function enqueueRun(runId: string, organizationId: string, suffix?: string, resume = false) {
  const jobId = suffix ? `agent-run:${runId}:${suffix}` : `agent-run:${runId}`;
  // Three attempts with exponential backoff; the last failure parks the job on `dead-letter`.
  await queues().enqueue(
    "agent-run",
    jobId,
    { runId, organizationId, ...(resume ? { resume: true } : {}) },
    { attempts: AGENT_RUN_JOB_OPTIONS.attempts, backoffMs: AGENT_RUN_JOB_OPTIONS.backoffMs },
  );
}

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------

export async function createRun(ctx: OrgContext, input: CreateRunInput): Promise<AgentRunDetail> {
  const organizationId = ctx.organization.id;
  const settings = await loadAgentSettings(organizationId);
  const ids = [...new Set(input.socialAccountIds)];
  const accounts = await prisma.socialAccount.findMany({ where: { organizationId, id: { in: ids } } });
  if (accounts.length !== ids.length) throw badRequest("One or more accounts do not belong to this organization");
  const notConnected = accounts.filter((a) => a.status !== "CONNECTED");
  if (notConnected.length)
    throw badRequest(`Reconnect ${notConnected.map((a) => a.displayName).join(", ")} before starting a campaign`);

  const active = await prisma.agentRun.count({ where: { organizationId, status: { in: [...ACTIVE_STATUSES] } } });
  if (active >= settings.agentMaxActiveRuns)
    throw conflict(`Your organization already has ${active} active campaign(s); wait for one to finish or raise the limit`);

  const requestedMode = input.publishMode ?? settings.agentPublishMode;
  const publishMode: AgentPublishMode =
    requestedMode === "AUTOMATIC" && !(ctx.can("content:publish") && settings.agentPublishMode === "AUTOMATIC")
      ? "APPROVAL_REQUIRED"
      : requestedMode;
  const maxCents = Math.min(input.maxCents ?? settings.agentRunMaxCents, settings.agentRunMaxCents);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw badRequest("Invalid scheduledAt");

  const run = await prisma.agentRun.create({
    data: {
      organizationId,
      createdById: ctx.user.id,
      topic: input.topic,
      goal: input.goal,
      audience: input.audience,
      notes: input.notes,
      platforms: [...new Set(accounts.map((a) => a.platform))],
      skillIds: [...new Set(input.skillIds ?? [])],
      preferredModel: input.model ?? null,
      wantsImage: input.image ?? false,
      status: "QUEUED",
      assurance: input.assurance ?? settings.agentAssurance,
      publishMode,
      scheduledAt,
      timezone: input.timezone ?? settings.timezone,
      maxCents,
      accounts: { create: accounts.map((a) => ({ socialAccountId: a.id, platform: a.platform })) },
      events: { create: { step: "create", status: "SUCCEEDED", output: { publishMode, maxCents } } },
    },
    include: runDetailInclude,
  });
  await enqueueRun(run.id, organizationId);
  await audit(ctx, "agent.run.create", "AgentRun", run.id, {
    topic: run.topic,
    accounts: ids.length,
    publishMode,
    maxCents,
    skills: run.skillIds.length,
    model: run.preferredModel,
    downgraded: requestedMode !== publishMode,
  });
  return run;
}

export async function listRuns(
  ctx: OrgContext,
  opts: { status?: AgentRunStatus; page: number; pageSize: number },
): Promise<{ items: AgentRunListItem[]; total: number; page: number; pageSize: number }> {
  const where: Prisma.AgentRunWhereInput = {
    organizationId: ctx.organization.id,
    ...(opts.status ? { status: opts.status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.agentRun.findMany({
      where,
      include: runListInclude,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.agentRun.count({ where }),
  ]);
  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

export async function getRun(ctx: OrgContext, runId: string): Promise<AgentRunDetail> {
  return loadRun(ctx.organization.id, runId);
}

async function loadRun(organizationId: string, runId: string): Promise<AgentRunDetail> {
  const run = await prisma.agentRun.findFirst({ where: { id: runId, organizationId }, include: runDetailInclude });
  if (!run) throw notFound("Campaign");
  return run;
}

// ---------------------------------------------------------------------------
// Lifecycle actions
// ---------------------------------------------------------------------------

async function transition(
  runId: string,
  from: AgentRunStatus,
  to: AgentRunStatus,
  data: Prisma.AgentRunUpdateInput = {},
): Promise<void> {
  assertRunTransition(from, to);
  await prisma.agentRun.update({ where: { id: runId }, data: { status: to, ...data } });
}

async function addEvent(runId: string, step: string, output: Record<string, unknown>) {
  await prisma.agentRunEvent.create({
    data: { runId, step, status: "SUCCEEDED", output: output as Prisma.InputJsonObject },
  });
}

export async function pauseRun(ctx: OrgContext, runId: string): Promise<AgentRunDetail> {
  const run = await loadRun(ctx.organization.id, runId);
  if (run.status === "PAUSED") throw conflict("Campaign is already paused");
  await transition(runId, run.status, "PAUSED", { resumeStatus: run.status });
  await addEvent(runId, "pause", { by: ctx.user.id, from: run.status });
  await audit(ctx, "agent.run.pause", "AgentRun", runId, { from: run.status });
  return loadRun(ctx.organization.id, runId);
}

export async function resumeRun(ctx: OrgContext, runId: string): Promise<AgentRunDetail> {
  const run = await loadRun(ctx.organization.id, runId);
  if (run.status !== "PAUSED" && run.status !== "BLOCKED")
    throw conflict(`Campaign cannot be resumed while ${run.status.toLowerCase().replaceAll("_", " ")}`);
  const target: AgentRunStatus = run.resumeStatus ?? "QUEUED";
  await transition(runId, run.status, target, { resumeStatus: null, blockedReason: null, error: null });
  await addEvent(runId, "resume", { by: ctx.user.id, to: target });
  await audit(ctx, "agent.run.resume", "AgentRun", runId, { to: target });
  if (target === "APPROVED") {
    // Publishing does not need the pipeline worker: re-validate and apply now.
    await applyApprovedRun(runId);
  } else if (WORKER_STATUSES.has(target)) {
    await enqueueRun(runId, ctx.organization.id, `resume-${Date.now()}`, true);
  }
  return loadRun(ctx.organization.id, runId);
}

export async function cancelRun(ctx: OrgContext, runId: string): Promise<AgentRunDetail> {
  const run = await loadRun(ctx.organization.id, runId);
  await transition(runId, run.status, "CANCELLED", { resumeStatus: null, completedAt: new Date() });
  await queues()
    .remove("agent-run", `agent-run:${runId}`)
    .catch(() => false);
  await addEvent(runId, "cancel", { by: ctx.user.id, from: run.status });
  await audit(ctx, "agent.run.cancel", "AgentRun", runId, { from: run.status });
  return loadRun(ctx.organization.id, runId);
}

export async function retryRun(ctx: OrgContext, runId: string): Promise<AgentRunDetail> {
  const run = await loadRun(ctx.organization.id, runId);
  if (run.status !== "FAILED") throw conflict("Only failed campaigns can be retried");
  await transition(runId, "FAILED", "QUEUED", { attempt: 0, error: null, blockedReason: null, resumeStatus: null });
  await addEvent(runId, "retry", { by: ctx.user.id });
  await audit(ctx, "agent.run.retry", "AgentRun", runId);
  await enqueueRun(runId, ctx.organization.id, `retry-${Date.now()}`, true);
  return loadRun(ctx.organization.id, runId);
}

// ---------------------------------------------------------------------------
// Human decisions
// ---------------------------------------------------------------------------

/** Who is deciding. Built from an OrgContext (UI/API) or from an approval token (email link). */
export interface DecisionActor {
  userId: string;
  organizationId: string;
  role: OrgRole | undefined;
  isSuperAdmin: boolean;
  overrides: OrgPermissionOverrides;
  impersonatedBy: string | null;
}

export function actorFromContext(ctx: OrgContext): DecisionActor {
  return {
    userId: ctx.user.id,
    organizationId: ctx.organization.id,
    role: ctx.role,
    isSuperAdmin: ctx.actor.isSuperAdmin === true,
    overrides: ctx.overrides,
    impersonatedBy: ctx.impersonatedBy,
  };
}

function actorCan(actor: DecisionActor, capability: Capability): boolean {
  return can({ userId: actor.userId, isSuperAdmin: actor.isSuperAdmin, role: actor.role }, capability, {
    overrides: actor.overrides,
  });
}

export async function decideAccounts(ctx: OrgContext, runId: string, input: DecideInput): Promise<AgentRunDetail> {
  return applyAccountDecision(actorFromContext(ctx), runId, input, "ui");
}

/**
 * Shared decision logic (UI route and email-token consumption). Mirrors the
 * post review rules: needs `content:approve`, and the run creator may not
 * approve their own campaign unless they are an OWNER/ADMIN.
 */
export async function applyAccountDecision(
  actor: DecisionActor,
  runId: string,
  input: DecideInput,
  source: "ui" | "email",
): Promise<AgentRunDetail> {
  if (!actorCan(actor, "content:approve"))
    throw new ApiError(403, "You do not have permission to approve campaigns", "forbidden");
  const run = await loadRun(actor.organizationId, runId);
  if (run.status !== "AWAITING_APPROVAL") throw conflict("Campaign is not awaiting approval");
  if (run.createdById === actor.userId && actor.role !== "OWNER" && actor.role !== "ADMIN" && !actor.isSuperAdmin)
    throw new ApiError(403, "You cannot approve your own campaign", "forbidden");

  const wanted = new Set(input.accountIds);
  const targets = run.accounts.filter((a) => wanted.has(a.id) || wanted.has(a.socialAccountId));
  if (targets.length !== wanted.size) throw badRequest("One or more accounts do not belong to this campaign");
  const alreadyDecided = targets.filter((a) => a.decision !== "PENDING");
  if (alreadyDecided.length)
    throw conflict(`${alreadyDecided.map((a) => a.socialAccount.displayName).join(", ")} already decided`);
  if (input.editedText !== undefined && targets.length !== 1)
    throw badRequest("Edited text can only be submitted for a single account");

  const now = new Date();
  await prisma.$transaction(
    targets.map((a) => {
      const edited =
        input.decision === "APPROVED" && input.editedText !== undefined && input.editedText.trim() !== (a.finalText ?? "").trim()
          ? input.editedText
          : null;
      return prisma.agentRunAccount.update({
        where: { id: a.id },
        data: {
          decision: input.decision,
          decidedById: actor.userId,
          decidedAt: now,
          decisionComment: input.comment ?? null,
          editedText: edited,
        },
      });
    }),
  );
  await prisma.agentRunEvent.create({
    data: {
      runId,
      step: "decision",
      status: "SUCCEEDED",
      output: {
        decision: input.decision,
        accounts: targets.map((a) => a.socialAccountId),
        by: actor.userId,
        source,
        comment: input.comment ?? null,
        edited: input.editedText !== undefined,
      },
    },
  });
  await auditPlatform(
    actor.userId,
    input.decision === "APPROVED" ? "agent.run.approve" : "agent.run.reject",
    "AgentRun",
    runId,
    { accounts: targets.map((a) => a.socialAccountId), comment: input.comment, source },
    actor.organizationId,
  );

  // Learning signals: edits and rejection comments become account preferences.
  for (const a of targets) {
    const before = a.finalText ?? "";
    const after = input.decision === "APPROVED" && input.editedText !== undefined ? input.editedText : before;
    const isEdit = after.trim() !== before.trim();
    const hasComment = Boolean(input.comment?.trim());
    if (!isEdit && !hasComment) continue;
    await recordHumanEdit(a.socialAccountId, {
      before,
      after,
      comment: input.comment,
      source: isEdit ? "edit" : input.decision === "REJECTED" ? "rejection" : "comment",
    }).catch(() => undefined);
  }

  await settleRunAfterDecision(runId, actor.organizationId);
  return loadRun(actor.organizationId, runId);
}

/** When every account is decided, move the run forward (apply or complete). */
async function settleRunAfterDecision(runId: string, organizationId: string): Promise<void> {
  const run = await loadRun(organizationId, runId);
  if (run.status !== "AWAITING_APPROVAL") return;
  if (run.accounts.some((a) => a.decision === "PENDING")) return;
  const anyApproved = run.accounts.some((a) => a.decision === "APPROVED");
  if (anyApproved) {
    await transition(runId, "AWAITING_APPROVAL", "APPROVED", { blockedReason: null });
    await applyApprovedRun(runId);
    return;
  }
  await transition(runId, "AWAITING_APPROVAL", "COMPLETED", { blockedReason: null, completedAt: new Date() });
  await addEvent(runId, "complete", { reason: "all accounts rejected" });
}
