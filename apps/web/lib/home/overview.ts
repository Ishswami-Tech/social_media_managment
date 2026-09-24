/**
 * The small facts Home shows next to the one current post: what else waits
 * for a decision, and which models actually wrote drafts today.
 */
import { prisma } from "@/lib/db";
import { modelLabel, providerName } from "@platform/agent-council/progress";

export interface WaitingItem {
  runId: string;
  topic: string;
  accounts: string[];
  /** Best judge score among the pending winners, 0-100, when known. */
  score: number | null;
  waitingSince: string;
}

export interface ModelUse {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  drafts: number;
}

const WAITING_LIMIT = 8;
const MODELS_WINDOW_MS = 24 * 60 * 60_000;

/** Runs awaiting a decision, oldest first, minus the one already shown in full. */
export async function loadAlsoWaiting(organizationId: string, excludeRunId?: string): Promise<WaitingItem[]> {
  const runs = await prisma.agentRun.findMany({
    where: { organizationId, status: "AWAITING_APPROVAL", ...(excludeRunId ? { id: { not: excludeRunId } } : {}) },
    orderBy: { updatedAt: "asc" },
    take: WAITING_LIMIT,
    select: {
      id: true,
      topic: true,
      updatedAt: true,
      accounts: {
        select: {
          decision: true,
          winnerDraftId: true,
          socialAccount: { select: { displayName: true } },
          drafts: { select: { id: true, judgeScore: true } },
        },
      },
    },
  });
  return runs.map((run) => {
    const pending = run.accounts.filter((a) => a.decision === "PENDING");
    const scores = pending
      .map((a) => a.drafts.find((d) => d.id === a.winnerDraftId)?.judgeScore)
      .filter((s): s is number => typeof s === "number");
    return {
      runId: run.id,
      topic: run.topic,
      accounts: pending.map((a) => a.socialAccount.displayName),
      score: scores.length ? Math.round(Math.max(...scores)) : null,
      waitingSince: run.updatedAt.toISOString(),
    };
  });
}

/** Which models wrote drafts in the last day, busiest first. Answers "is it only using one model?". */
export async function loadModelsToday(organizationId: string): Promise<ModelUse[]> {
  const since = new Date(Date.now() - MODELS_WINDOW_MS);
  const drafts = await prisma.agentDraft.groupBy({
    by: ["provider", "model"],
    where: { runAccount: { run: { organizationId, createdAt: { gte: since } } } },
    _count: { _all: true },
  });
  return drafts
    .map((d) => ({
      provider: d.provider,
      providerLabel: providerName(d.provider),
      model: d.model,
      label: modelLabel(d.model, d.provider) ?? d.model,
      drafts: d._count._all,
    }))
    .sort((a, b) => b.drafts - a.drafts);
}
