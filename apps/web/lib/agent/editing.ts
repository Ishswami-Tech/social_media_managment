/**
 * Editing a recommendation before approval: save a manual draft, ask the
 * editor agent for a change, or override the judge with another draft. All
 * three leave the run in AWAITING_APPROVAL; nothing here publishes.
 */
import { z } from "zod";
import {
  adaptChosenDraft,
  choosableDraft,
  isPipelineBlocked,
  MAX_INSTRUCTION_CHARS,
  reviseRecommendation,
  RevisionRejected,
} from "@platform/agent-council";
import { buildPipelineContext } from "@/lib/agent/context";
import { recordHumanEdit } from "@/lib/agent/learning";
import { performanceFor, type PerformanceView } from "@/lib/agent/performance";
import { createPrismaRunStore } from "@/lib/agent/store";
import { composeFinalText } from "@/lib/agent/apply";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ApiError, badRequest, conflict, notFound } from "@/lib/errors";
import type { OrgContext } from "@/lib/session";

export const saveDraftInput = z.object({
  accountId: z.string().min(1),
  editedText: z.string().max(65_000),
});

export const reviseInput = z.object({
  accountId: z.string().min(1),
  instruction: z.string().trim().min(2).max(MAX_INSTRUCTION_CHARS),
});

export const useDraftInput = z.object({
  accountId: z.string().min(1),
  draftId: z.string().min(1),
});

export interface EditedRecommendation {
  /** Final text with hashtags, as the UI shows it. */
  text: string;
  performance: PerformanceView | null;
  /** The editor's one-line note (revise only). */
  note?: string;
}

const accountSelect = {
  id: true,
  runId: true,
  platform: true,
  socialAccountId: true,
  finalText: true,
  editedText: true,
  finalHashtags: true,
  strategy: true,
  winnerDraftId: true,
  decision: true,
  drafts: { select: { id: true, judgeScore: true } },
  socialAccount: { select: { displayName: true, profile: true } },
} as const;

async function loadEditable(ctx: OrgContext, runId: string, accountId: string) {
  if (!ctx.can("content:approve")) throw new ApiError(403, "You do not have permission to edit campaigns", "forbidden");
  const run = await prisma.agentRun.findFirst({ where: { id: runId, organizationId: ctx.organization.id }, select: { id: true, status: true } });
  if (!run) throw notFound("Campaign");
  if (run.status !== "AWAITING_APPROVAL") throw conflict("The post can only be edited while it waits for approval");
  const account = await prisma.agentRunAccount.findFirst({ where: { id: accountId, runId }, select: accountSelect });
  if (!account) throw badRequest("That account is not part of this campaign");
  if (account.decision !== "PENDING") throw conflict("This account was already decided");
  if (!account.finalText) throw conflict("There is no text to edit yet");
  return account;
}

function view(account: Awaited<ReturnType<typeof loadEditable>>, note?: string): EditedRecommendation {
  const base = account.editedText ?? account.finalText ?? "";
  return {
    text: composeFinalText(base, account.finalHashtags),
    performance: performanceFor(account),
    ...(note ? { note } : {}),
  };
}

/** Persists a manual edit without approving; an edit identical to the AI's text clears the draft. */
export async function saveDraftText(ctx: OrgContext, runId: string, input: z.infer<typeof saveDraftInput>): Promise<EditedRecommendation> {
  const account = await loadEditable(ctx, runId, input.accountId);
  const trimmed = input.editedText.trim();
  const editedText = trimmed && trimmed !== (account.finalText ?? "").trim() ? input.editedText : null;
  const updated = await prisma.agentRunAccount.update({ where: { id: account.id }, data: { editedText }, select: accountSelect });
  await prisma.agentRunEvent.create({
    data: { runId, step: `edit:${account.id}`, status: "SUCCEEDED", output: { by: ctx.user.id, saved: editedText !== null } },
  });
  await audit(ctx, "agent.run.edit", "AgentRun", runId, { accountId: account.id, saved: editedText !== null });
  return view(updated);
}

/**
 * Asks the editor agent for the change, with the claims ledger, playbooks and
 * checks the pipeline used. The instruction becomes an explicit preference on
 * the account so later posts lean the same way.
 */
export async function reviseWithAi(ctx: OrgContext, runId: string, input: z.infer<typeof reviseInput>): Promise<EditedRecommendation> {
  const account = await loadEditable(ctx, runId, input.accountId);
  const [pipeline, snapshot] = await Promise.all([buildPipelineContext(ctx.organization.id, runId), createPrismaRunStore().load(runId)]);
  const runAccount = snapshot.accounts.find((a) => a.runAccountId === account.id);
  if (!runAccount) throw badRequest("That account is not part of this campaign");
  const current = { text: account.editedText ?? account.finalText ?? "", hashtags: account.finalHashtags };
  let revision;
  try {
    revision = await reviseRecommendation(pipeline, snapshot, runAccount, current, input.instruction);
  } catch (error) {
    if (error instanceof RevisionRejected) throw badRequest(error.message, error.checks.issues);
    if (isPipelineBlocked(error)) throw conflict(error.message);
    throw error;
  }
  const updated = await prisma.agentRunAccount.update({
    where: { id: account.id },
    data: { editedText: revision.text, finalHashtags: revision.hashtags },
    select: accountSelect,
  });
  await prisma.agentRunEvent.create({
    data: {
      runId,
      step: `edit:${account.id}`,
      status: "SUCCEEDED",
      provider: revision.provider,
      model: revision.model,
      costCents: revision.costCents,
      input: input.instruction,
      output: { by: ctx.user.id, note: revision.note, saved: true },
    },
  });
  await recordHumanEdit(account.socialAccountId, {
    before: current.text,
    after: revision.text,
    comment: input.instruction,
    source: "explicit",
  }).catch(() => undefined);
  await audit(ctx, "agent.run.revise", "AgentRun", runId, { accountId: account.id, provider: revision.provider, model: revision.model });
  return view(updated, revision.note);
}

/** Overrides the judge with another draft of this account and runs the platform pass on it. */
export async function chooseDraftInstead(ctx: OrgContext, runId: string, input: z.infer<typeof useDraftInput>): Promise<EditedRecommendation> {
  const account = await loadEditable(ctx, runId, input.accountId);
  const [pipeline, snapshot] = await Promise.all([buildPipelineContext(ctx.organization.id, runId), createPrismaRunStore().load(runId)]);
  const runAccount = snapshot.accounts.find((a) => a.runAccountId === account.id);
  if (!runAccount) throw badRequest("That account is not part of this campaign");
  const draft = choosableDraft(runAccount, input.draftId);
  if (!draft) throw badRequest("Pick one of this account's written drafts");
  try {
    await adaptChosenDraft(pipeline, snapshot, runAccount, draft);
  } catch (error) {
    if (isPipelineBlocked(error)) throw conflict(error.message);
    throw error;
  }
  const updated = await prisma.agentRunAccount.update({ where: { id: account.id }, data: { editedText: null }, select: accountSelect });
  await audit(ctx, "agent.run.choose_draft", "AgentRun", runId, { accountId: account.id, draftId: draft.id, label: draft.label });
  return view(updated);
}
