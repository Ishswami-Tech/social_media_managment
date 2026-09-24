/**
 * Edits a person asks for after the pipeline finished: a plain-language
 * request ("shorter", "drop the second number", "rewrite the hook") applied
 * by the editor with the same claims ledger, playbooks and deterministic
 * checks the pipeline used. Nothing here publishes; the recommendation is
 * updated and the person still approves.
 */
import { z } from "zod";
import { checkErrors, runChecks } from "../checks";
import type { CheckResult, DraftCandidate, PipelineContext, RunSnapshot } from "../contracts";
import { renderPrompt } from "../prompts";
import { callJson } from "./call";
import {
  accountVars,
  checkInputFor,
  claimsText,
  DraftOutputSchema,
  filterClaimIds,
  plannedMedia,
  stepName,
  supportedClaims,
  withSkills,
  type RunAccountSnapshot,
} from "./shared";

const REVISE_OUTPUT_TOKENS = 1_200;
export const MAX_INSTRUCTION_CHARS = 1_000;

export const ReviseOutputSchema = DraftOutputSchema.extend({ note: z.string().default("") });

export interface Revision {
  text: string;
  hashtags: string[];
  claimIds: string[];
  note: string;
  checks: CheckResult;
  provider: string;
  model: string;
  costCents: number;
}

/** Thrown when the requested change would break a rule the pipeline enforces. */
export class RevisionRejected extends Error {
  constructor(
    message: string,
    public readonly checks: CheckResult,
  ) {
    super(message);
    this.name = "RevisionRejected";
  }
}

/**
 * Applies the instruction to the account's current text. The result must
 * pass the same checks a draft passes; otherwise it is rejected with the
 * reasons and nothing is stored.
 */
export async function reviseRecommendation(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  current: { text: string; hashtags: string[] },
  instruction: string,
): Promise<Revision> {
  const asked = instruction.trim().slice(0, MAX_INSTRUCTION_CHARS);
  const { value, call } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: stepName("revise", account),
      promptKey: "revise-request",
      temperature: 0.3,
      expectedOutputTokens: REVISE_OUTPUT_TOKENS,
      system: withSkills(
        ctx,
        renderPrompt("revise-request", {
          ...accountVars(account),
          claims: claimsText(supportedClaims(run.claims)),
          text: current.text,
          hashtags: current.hashtags.join(" "),
          instruction: asked,
        }),
        run,
        account.platform,
      ),
      user: "Apply the request now. Return only the JSON object.",
    },
    ReviseOutputSchema,
  );
  const draft = { text: value.text, hashtags: value.hashtags };
  const checks = runChecks(checkInputFor(ctx, run, account, draft, plannedMedia(account)));
  if (!checks.ok) {
    throw new RevisionRejected(
      `That change would break a rule: ${checkErrors(checks)
        .map((i) => i.message)
        .join("; ")}`,
      checks,
    );
  }
  return {
    text: value.text,
    hashtags: value.hashtags,
    claimIds: filterClaimIds(value.claimIds, run.claims),
    note: value.note,
    checks,
    provider: call.provider,
    model: call.model,
    costCents: call.costCents,
  };
}

/** The draft a person may choose instead of the judge's pick: a writer or revision draft of this account. */
export function choosableDraft(account: RunAccountSnapshot, draftId: string): DraftCandidate | undefined {
  return account.drafts.find((d) => d.id === draftId && (d.role === "WRITER" || d.role === "REVISION"));
}
