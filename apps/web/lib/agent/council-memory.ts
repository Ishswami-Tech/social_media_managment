/**
 * After every run, each account's brain learns from what its council did:
 * the lane the blind judge picked, the winning opening line, the notes the
 * reviewers raised and the angle the strategist chose. Read by the next run's
 * prompts through the Account Brain.
 */
import { firstLine, mergeCouncilMemory, WRITER_LANES, type CouncilMemory, type CouncilObservation } from "@platform/agent-council";
import type { Prisma } from "@platform/database";
import { prisma } from "../db";
import { logger, errorInfo } from "../logger";

const VERDICT_STEP = "judge.verdict";

function jsonObject<T>(value: Prisma.JsonValue | null | undefined): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : undefined;
}

/** What one run tells us about each of its accounts, keyed by social account id. */
export async function observeRun(runId: string): Promise<Map<string, CouncilObservation>> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: {
      accounts: { select: { id: true, socialAccountId: true, strategy: true, drafts: { select: { label: true, role: true, text: true } } } },
      events: { where: { step: { startsWith: "review" } }, select: { step: true, status: true, input: true, output: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!run) return new Map();
  const verdicts = await prisma.agentRunEvent.findMany({ where: { runId, step: VERDICT_STEP }, select: { input: true, output: true } });
  const out = new Map<string, CouncilObservation>();
  for (const account of run.accounts) {
    const verdict = verdicts.find((v) => jsonObject<{ runAccountId?: string }>(v.input)?.runAccountId === account.id);
    const winner = jsonObject<{ winner?: string }>(verdict?.output)?.winner;
    const winningDraft = winner ? account.drafts.find((d) => d.label === winner && d.role === "WRITER") : undefined;
    const issues = run.events
      .filter((e) => e.status === "SUCCEEDED" && e.step.startsWith(`review:${account.id}:`) && !/:m\d+$/.test(e.step))
      .flatMap((e) => jsonObject<{ issues?: string[] }>(e.output)?.issues ?? []);
    const angle = jsonObject<{ angle?: string }>(account.strategy)?.angle;
    out.set(account.socialAccountId, {
      ...(winner ? { winnerLane: WRITER_LANES[winner]?.name ?? winner } : {}),
      ...(winningDraft ? { winnerFirstLine: firstLine(winningDraft.text) } : {}),
      ...(issues.length ? { reviewIssues: issues } : {}),
      ...(angle ? { angle } : {}),
      at: new Date().toISOString(),
    });
  }
  return out;
}

/** Folds one finished run into the council memory of every account it worked for. */
export async function learnCouncilMemory(runId: string): Promise<number> {
  const observations = await observeRun(runId);
  let learned = 0;
  for (const [socialAccountId, seen] of observations) {
    try {
      const profile = await prisma.accountProfile.findUnique({ where: { socialAccountId }, select: { council: true } });
      const account = await prisma.socialAccount.findUnique({ where: { id: socialAccountId }, select: { organizationId: true } });
      if (!account) continue;
      const next = mergeCouncilMemory(jsonObject<CouncilMemory>(profile?.council), seen);
      await prisma.accountProfile.upsert({
        where: { socialAccountId },
        create: { socialAccountId, organizationId: account.organizationId, council: next as Prisma.InputJsonObject },
        update: { council: next as Prisma.InputJsonObject },
      });
      learned += 1;
    } catch (error) {
      logger.warn("council memory not updated", { runId, socialAccountId, ...errorInfo(error) });
    }
  }
  return learned;
}
