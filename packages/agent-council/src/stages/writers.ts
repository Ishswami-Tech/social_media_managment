/**
 * DRAFTING: two to three writers per account, spread across the providers the
 * organization may use. Labels are blind (A/B/C) so the judge can never link a
 * draft to a provider, and a writer that fails only costs its own draft.
 */
import { AI_PROVIDERS, type AIProviderName } from "@platform/types";
import type { DraftCandidate, PipelineContext, RunSnapshot } from "../contracts";
import { errorMessage, isPipelineBlocked, PipelineBlocked } from "../errors";
import { renderPrompt } from "../prompts";
import { callJson, type ProviderPreference } from "./call";
import {
  accountVars,
  claimsText,
  DRAFT_LABELS,
  DraftOutputSchema,
  filterClaimIds,
  stepName,
  strategyText,
  supportedClaims,
  withSkills,
  type RunAccountSnapshot,
} from "./shared";

const WRITER_OUTPUT_TOKENS = 1_200;
/** Used when a single provider writes every draft, so the drafts still differ. */
export const SINGLE_PROVIDER_TEMPERATURES = [0.6, 0.8, 1.0] as const;
const MULTI_PROVIDER_TEMPERATURE = 0.8;

export interface WriterSlot {
  label: string;
  pref: ProviderPreference;
  temperature: number;
}

/** "PROVIDER::model" allow-list entries the organization may actually use. */
export function parseAllowedModels(
  allowedModels: readonly string[] | undefined,
  availableProviders: readonly AIProviderName[],
): ProviderPreference[] {
  return (allowedModels ?? []).flatMap((entry) => {
    const [provider, model] = entry.split("::");
    if (!provider || !model) return [];
    if (!AI_PROVIDERS.includes(provider as AIProviderName)) return [];
    const name = provider as AIProviderName;
    return availableProviders.includes(name) ? [{ provider: name, model }] : [];
  });
}

/**
 * Writer slots: one per label, spread round-robin over the allowed models (or
 * over the available providers with routing on auto when there is no
 * allow-list). A single provider writes three drafts at different temperatures.
 */
export function planWriters(ctx: PipelineContext): WriterSlot[] {
  const allowed = parseAllowedModels(ctx.allowedModels, ctx.availableProviders);
  const prefs: ProviderPreference[] =
    allowed.length > 0 ? allowed : ctx.availableProviders.map((provider) => ({ provider }));
  const pool = prefs.length > 0 ? prefs : [{}];
  const distinct = new Set(pool.map((p) => p.provider)).size;
  const count = pool.length === 1 ? DRAFT_LABELS.length : Math.min(DRAFT_LABELS.length, pool.length);
  return DRAFT_LABELS.slice(0, count).map((label, index) => ({
    label,
    pref: pool[index % pool.length] ?? {},
    temperature: distinct <= 1 ? (SINGLE_PROVIDER_TEMPERATURES[index] ?? MULTI_PROVIDER_TEMPERATURE) : MULTI_PROVIDER_TEMPERATURE,
  }));
}

async function writeDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  slot: WriterSlot,
): Promise<DraftCandidate> {
  const { value, call } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: stepName("writer", account, slot.label),
      promptKey: "writer",
      pref: slot.pref,
      temperature: slot.temperature,
      expectedOutputTokens: WRITER_OUTPUT_TOKENS,
      system: withSkills(
        ctx,
        renderPrompt("writer", {
          ...accountVars(account),
          strategy: strategyText(account.strategy),
          claims: claimsText(supportedClaims(run.claims)),
        }),
      ),
      user: "Write the post now. Return only the JSON object.",
    },
    DraftOutputSchema,
  );
  return {
    label: slot.label,
    role: "WRITER",
    provider: call.provider,
    model: call.model,
    promptKey: call.promptKey,
    promptVersion: call.promptVersion,
    promptHash: call.promptHash,
    text: value.text,
    hashtags: value.hashtags,
    claimIds: filterClaimIds(value.claimIds, run.claims),
    costCents: call.costCents,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
    latencyMs: call.latencyMs,
  };
}

/** DRAFTING: writes and persists the candidate drafts of every account. */
export async function writersStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  const slots = planWriters(ctx);
  let written = 0;
  for (const account of run.accounts) {
    let perAccount = 0;
    for (const slot of slots) {
      try {
        const draft = await writeDraft(ctx, run, account, slot);
        await ctx.store.saveDraft(run.id, account.runAccountId, draft);
        perAccount += 1;
      } catch (error) {
        if (isPipelineBlocked(error)) throw error;
        await ctx.store.addEvent(run.id, {
          step: stepName("writer", account, slot.label),
          status: "SKIPPED",
          error: errorMessage(error),
        });
      }
    }
    if (perAccount === 0) {
      await ctx.store.addEvent(run.id, {
        step: stepName("writer", account),
        status: "SKIPPED",
        error: "no writer produced a usable draft for this account",
      });
    }
    written += perAccount;
  }
  if (written === 0) throw new PipelineBlocked("no valid drafts");
}
