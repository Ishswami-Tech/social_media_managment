import type {
  AccountBrain,
  AccountRecommendation,
  AccountStrategy,
  AgentRunStore,
  CampaignBrief,
  ClaimRecord,
  DraftCandidate,
  JudgeVerdict,
  ReviewNote,
  RunAccount,
  RunSnapshot,
  StepEvent,
} from "@platform/agent-council";
import type { Prisma } from "@platform/database";
import type { Brief } from "@platform/research";
import {
  AGENT_PIPELINE,
  assertRunTransition,
  type AIProviderName,
  type AgentRunStatus,
  type Platform,
  type PlatformCapabilities,
} from "@platform/types";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { providers } from "@/lib/providers";

/**
 * Prisma implementation of the Agent Council persistence port. The pipeline
 * never touches Prisma; every read/write of run state goes through here.
 *
 * Judge verdicts and cross-review notes have no dedicated columns: they are
 * stored as `AgentRunEvent` rows (steps below) tagged with the run account id,
 * which also makes them part of the replay timeline.
 */

export const VERDICT_EVENT_STEP = "judge.verdict";
export const REVIEW_NOTES_EVENT_STEP = "review.notes";

/** Used only when neither a registered provider nor the account's synced snapshot describes the platform. */
const FALLBACK_CAPABILITIES: PlatformCapabilities = {
  text: { maxLength: 2000 },
  media: { kinds: ["IMAGE"], maxCount: 1, required: false },
  supportsCarousel: false,
  supportsScheduling: false,
  supportsLinkPreview: true,
  supportsHashtags: true,
  supportsFirstComment: false,
};

const TERMINAL_STATUSES: readonly AgentRunStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];
const SIDE_STATUSES: readonly AgentRunStatus[] = ["PAUSED", "BLOCKED"];

/** JSON columns accept plain data only: round-trip through JSON to drop undefined/functions/Dates. */
export function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonObject<T extends object>(value: Prisma.JsonValue | null | undefined): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : undefined;
}

export function capabilitiesFor(platform: Platform, snapshot: Prisma.JsonValue | null): PlatformCapabilities {
  const registry = providers();
  if (registry.has(platform)) return registry.get(platform).capabilities;
  const synced = jsonObject<PlatformCapabilities>(snapshot);
  if (synced?.text && synced.media) return synced;
  logger.warn("no capabilities known for platform; using conservative fallback", { platform });
  return FALLBACK_CAPABILITIES;
}

export function profileToBrain(profile: {
  identity: Prisma.JsonValue | null;
  audience: Prisma.JsonValue | null;
  voice: Prisma.JsonValue | null;
  content: Prisma.JsonValue | null;
  performance: Prisma.JsonValue | null;
  humanFeedback: Prisma.JsonValue | null;
} | null): AccountBrain {
  if (!profile) return {};
  const brain: AccountBrain = {
    identity: jsonObject<AccountBrain["identity"] & object>(profile.identity),
    audience: jsonObject<AccountBrain["audience"] & object>(profile.audience),
    voice: jsonObject<AccountBrain["voice"] & object>(profile.voice),
    content: jsonObject<AccountBrain["content"] & object>(profile.content),
    performance: jsonObject<AccountBrain["performance"] & object>(profile.performance),
    humanFeedback: jsonObject<AccountBrain["humanFeedback"] & object>(profile.humanFeedback),
  };
  return Object.fromEntries(Object.entries(brain).filter(([, v]) => v !== undefined)) as AccountBrain;
}

type DraftRow = Prisma.AgentDraftGetPayload<Record<string, never>>;

export function draftToCandidate(row: DraftRow): DraftCandidate {
  return {
    id: row.id,
    label: row.label,
    role: row.role,
    provider: row.provider as AIProviderName,
    model: row.model,
    promptKey: row.promptKey,
    promptVersion: row.promptVersion,
    promptHash: row.promptHash,
    text: row.text,
    hashtags: row.hashtags,
    claimIds: row.claimIds,
    costCents: row.costCents,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
  };
}

/** Fields written on a status change, derived from the transition (pure so it can be unit-tested). */
export function statusUpdate(
  current: { status: AgentRunStatus; startedAt: Date | null; resumeStatus: AgentRunStatus | null },
  next: AgentRunStatus,
  extra: { currentStep?: string; error?: string; blockedReason?: string } | undefined,
  now: Date,
): Prisma.AgentRunUncheckedUpdateInput {
  const enteringSideState = SIDE_STATUSES.includes(next);
  const leavingSideState = SIDE_STATUSES.includes(current.status) && !enteringSideState;
  return {
    status: next,
    ...(extra?.currentStep !== undefined ? { currentStep: extra.currentStep } : {}),
    ...(extra?.error !== undefined ? { error: extra.error } : next === "QUEUED" ? { error: null } : {}),
    ...(enteringSideState
      ? { resumeStatus: SIDE_STATUSES.includes(current.status) ? current.resumeStatus : current.status }
      : leavingSideState
        ? { resumeStatus: null }
        : {}),
    ...(next === "BLOCKED"
      ? { blockedReason: extra?.blockedReason ?? "blocked" }
      : leavingSideState
        ? { blockedReason: null }
        : {}),
    ...(AGENT_PIPELINE.includes(next) && !current.startedAt ? { startedAt: now } : {}),
    ...(TERMINAL_STATUSES.includes(next) ? { completedAt: now } : {}),
  };
}

type EventRow = { step: string; input: Prisma.JsonValue | null; output: Prisma.JsonValue | null };

/** Latest verdict / review notes per run account, reconstructed from the event rows (oldest first). */
export function accountAnnotations(events: readonly EventRow[]): Map<string, { verdict?: JudgeVerdict; reviewNotes?: ReviewNote[] }> {
  return events.reduce((acc, e) => {
    const runAccountId = jsonObject<{ runAccountId?: string }>(e.input)?.runAccountId;
    if (!runAccountId) return acc;
    const prev = acc.get(runAccountId) ?? {};
    if (e.step === VERDICT_EVENT_STEP) {
      const verdict = jsonObject<JudgeVerdict>(e.output);
      if (verdict) acc.set(runAccountId, { ...prev, verdict });
    } else if (e.step === REVIEW_NOTES_EVENT_STEP && Array.isArray(e.output)) {
      acc.set(runAccountId, { ...prev, reviewNotes: e.output as unknown as ReviewNote[] });
    }
    return acc;
  }, new Map<string, { verdict?: JudgeVerdict; reviewNotes?: ReviewNote[] }>());
}

async function loadRun(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: {
      claims: { orderBy: { createdAt: "asc" } },
      accounts: {
        orderBy: { createdAt: "asc" },
        include: {
          socialAccount: { include: { profile: true } },
          drafts: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!run) throw new Error(`Agent run ${runId} not found`);
  return run;
}

export function createPrismaRunStore(now: () => Date = () => new Date()): AgentRunStore {
  return {
    async load(runId): Promise<RunSnapshot> {
      const run = await loadRun(runId);
      const events = await prisma.agentRunEvent.findMany({
        where: { runId, step: { in: [VERDICT_EVENT_STEP, REVIEW_NOTES_EVENT_STEP] } },
        orderBy: { createdAt: "asc" },
        select: { step: true, input: true, output: true },
      });
      const annotations = accountAnnotations(events);
      const brief: CampaignBrief = {
        topic: run.topic,
        goal: run.goal,
        audience: run.audience ?? undefined,
        notes: run.notes ?? undefined,
        platforms: run.platforms,
      };
      const claims: ClaimRecord[] = run.claims.map((c) => ({
        id: c.id,
        statement: c.statement,
        sourceUrl: c.sourceUrl ?? undefined,
        sourceTitle: c.sourceTitle ?? undefined,
        evidence: c.evidence ?? undefined,
        confidence: c.confidence,
        status: c.status,
      }));
      const accounts: RunSnapshot["accounts"] = run.accounts.map((a) => {
        const drafts = a.drafts.map(draftToCandidate);
        const winner = a.winnerDraftId ? drafts.find((d) => d.id === a.winnerDraftId) : undefined;
        const base: RunAccount = {
          runAccountId: a.id,
          socialAccountId: a.socialAccountId,
          platform: a.platform,
          displayName: a.socialAccount.displayName,
          accountType: a.socialAccount.accountType,
          capabilities: capabilitiesFor(a.platform, a.socialAccount.capabilities),
          profile: profileToBrain(a.socialAccount.profile),
        };
        const recommendation: AccountRecommendation | undefined =
          a.finalText !== null
            ? {
                runAccountId: a.id,
                finalText: a.finalText,
                hashtags: a.finalHashtags,
                claimIds: winner?.claimIds ?? [],
                mediaConcept: a.mediaConcept ?? undefined,
                winnerDraftLabel: winner?.label ?? "",
              }
            : undefined;
        const extras = annotations.get(a.id);
        return {
          ...base,
          strategy: jsonObject<AccountStrategy>(a.strategy),
          drafts,
          ...(extras?.reviewNotes ? { reviewNotes: extras.reviewNotes } : {}),
          ...(extras?.verdict ? { verdict: extras.verdict } : {}),
          ...(recommendation ? { recommendation } : {}),
        };
      });
      return {
        id: run.id,
        organizationId: run.organizationId,
        status: run.status,
        currentStep: run.currentStep,
        skillIds: run.skillIds,
        assurance: run.assurance,
        publishMode: run.publishMode,
        brief,
        maxCents: run.maxCents,
        spentCents: run.spentCents,
        research: jsonObject<Brief>(run.research),
        claims,
        accounts,
      };
    },

    async setStatus(runId, status, extra) {
      const current = await prisma.agentRun.findUnique({
        where: { id: runId },
        select: { status: true, startedAt: true, resumeStatus: true },
      });
      if (!current) throw new Error(`Agent run ${runId} not found`);
      assertRunTransition(current.status, status);
      // Optimistic guard: a concurrent pause/cancel changes the status between the read and the write.
      const updated = await prisma.agentRun.updateMany({
        where: { id: runId, status: current.status },
        data: statusUpdate(current, status, extra, now()),
      });
      if (updated.count === 0) throw new Error(`Agent run ${runId} changed status concurrently; refusing ${status}`);
    },

    async markStep(runId, currentStep) {
      await prisma.agentRun.update({ where: { id: runId }, data: { currentStep } });
    },

    async saveSkills(runId, skillIds) {
      await prisma.agentRun.update({ where: { id: runId }, data: { skillIds } });
    },

    async saveResearch(runId, brief, claims) {
      const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { organizationId: true } });
      if (!run) throw new Error(`Agent run ${runId} not found`);
      const { organizationId } = run;
      return prisma.$transaction(async (tx) => {
        // Re-running research (retry) replaces the ledger instead of appending to it.
        await tx.claim.deleteMany({ where: { runId, organizationId } });
        const rows = await tx.claim.createManyAndReturn({
          data: claims.map((c) => ({
            runId,
            organizationId,
            statement: c.statement,
            sourceUrl: c.sourceUrl ?? null,
            sourceTitle: c.sourceTitle ?? null,
            evidence: c.evidence ?? null,
            confidence: c.confidence,
            status: c.status,
          })),
        });
        await tx.agentRun.update({
          where: { id: runId },
          data: { research: toJson(brief) ?? {} },
        });
        return rows.map((r) => ({
          id: r.id,
          statement: r.statement,
          sourceUrl: r.sourceUrl ?? undefined,
          sourceTitle: r.sourceTitle ?? undefined,
          evidence: r.evidence ?? undefined,
          confidence: r.confidence,
          status: r.status,
        }));
      });
    },

    async saveStrategy(runAccountId, strategy) {
      await prisma.agentRunAccount.update({ where: { id: runAccountId }, data: { strategy: toJson(strategy) ?? {} } });
    },

    async saveDraft(runId, runAccountId, draft, extra) {
      const row = await prisma.agentDraft.create({
        data: {
          runId,
          runAccountId,
          role: draft.role,
          label: draft.label,
          provider: draft.provider,
          model: draft.model,
          promptKey: draft.promptKey,
          promptVersion: draft.promptVersion,
          promptHash: draft.promptHash,
          text: draft.text,
          hashtags: draft.hashtags,
          claimIds: draft.claimIds,
          checks: toJson(extra?.checks),
          judgeScore: extra?.judgeScore ?? null,
          judgeRationale: extra?.judgeRationale ?? null,
          costCents: draft.costCents,
          inputTokens: draft.inputTokens,
          outputTokens: draft.outputTokens,
          latencyMs: draft.latencyMs,
        },
        select: { id: true },
      });
      return row.id;
    },

    async saveRecommendation(rec) {
      await prisma.agentRunAccount.update({
        where: { id: rec.runAccountId },
        data: {
          finalText: rec.finalText,
          finalHashtags: rec.hashtags,
          mediaConcept: rec.mediaConcept ?? null,
          winnerDraftId: rec.winnerDraftId ?? null,
        },
      });
    },

    async addEvent(runId, event: StepEvent) {
      await prisma.agentRunEvent.create({
        data: {
          runId,
          step: event.step,
          status: event.status,
          provider: event.provider ?? null,
          model: event.model ?? null,
          promptKey: event.promptKey ?? null,
          promptVersion: event.promptVersion ?? null,
          promptHash: event.promptHash ?? null,
          input: toJson(event.input),
          output: toJson(event.output),
          validation: toJson(event.validation),
          costCents: event.costCents ?? 0,
          latencyMs: event.latencyMs ?? 0,
          error: event.error ?? null,
        },
      });
    },

    async addCost(runId, cents) {
      if (!Number.isFinite(cents) || cents <= 0) return;
      await prisma.agentRun.update({ where: { id: runId }, data: { spentCents: { increment: cents } } });
    },

    async updateDraftJudgement(draftId, score, rationale) {
      await prisma.agentDraft.update({ where: { id: draftId }, data: { judgeScore: score, judgeRationale: rationale } });
    },

    async saveVerdict(runAccountId, verdict) {
      const account = await prisma.agentRunAccount.findUnique({ where: { id: runAccountId }, select: { runId: true } });
      if (!account) throw new Error(`Agent run account ${runAccountId} not found`);
      await prisma.agentRunEvent.create({
        data: {
          runId: account.runId,
          step: VERDICT_EVENT_STEP,
          status: "SUCCEEDED",
          input: { runAccountId },
          output: toJson(verdict),
        },
      });
    },

    async saveReviewNotes(runAccountId, notes) {
      const account = await prisma.agentRunAccount.findUnique({ where: { id: runAccountId }, select: { runId: true } });
      if (!account) throw new Error(`Agent run account ${runAccountId} not found`);
      await prisma.agentRunEvent.create({
        data: {
          runId: account.runId,
          step: REVIEW_NOTES_EVENT_STEP,
          status: "SUCCEEDED",
          input: { runAccountId },
          output: toJson(notes),
        },
      });
    },
  };
}
