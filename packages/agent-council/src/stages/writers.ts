/**
 * DRAFTING: two to three writers per account, spread across the providers the
 * organization may use. Labels are blind (A/B/C) so the judge can never link a
 * draft to a provider, and a writer that fails only costs its own draft.
 */
import { AI_PROVIDERS, type AIProviderName } from "@platform/types";
import type { DraftCandidate, PipelineContext, RunSnapshot } from "../contracts";
import { errorMessage, isPipelineBlocked, PipelineBlocked } from "../errors";
import { renderPrompt } from "../prompts";
import { WRITER_LANES } from "../progress";
import { callJson, type ProviderPreference } from "./call";
import { coolingProviders, TOP_MODELS_PER_PROVIDER, topPerProvider } from "./council";
import { accountVars, claimsText, DRAFT_LABELS, DraftOutputSchema, filterClaimIds, perAccount, stepName, strategyText, stripInlineClaimIds, supportedClaims, type RunAccountSnapshot, withSkills } from "./shared";

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
export function planWriters(ctx: PipelineContext, cooling: ReadonlySet<AIProviderName> = new Set()): WriterSlot[] {
  const allowed = parseAllowedModels(ctx.allowedModels, ctx.availableProviders);
  const prefs: ProviderPreference[] = allowed.length > 0 ? allowed : distinctModels(ctx, cooling);
  const pool = prefs.length > 0 ? prefs : [{}];
  const distinct = new Set(pool.map((p) => p.provider)).size;
  // An allow-list of two models means two writers; an automatic pool always fields the full bench, cycling models.
  const count = allowed.length > 0 && pool.length > 1 ? Math.min(DRAFT_LABELS.length, pool.length) : DRAFT_LABELS.length;
  const hottest = SINGLE_PROVIDER_TEMPERATURES[SINGLE_PROVIDER_TEMPERATURES.length - 1] ?? MULTI_PROVIDER_TEMPERATURE;
  return DRAFT_LABELS.slice(0, count).map((label, index) => ({
    label,
    pref: pool[index % pool.length] ?? {},
    // One provider: three temperatures. A writer that repeats a model runs hotter than the first one on it.
    temperature:
      distinct <= 1 ? (SINGLE_PROVIDER_TEMPERATURES[index] ?? MULTI_PROVIDER_TEMPERATURE) : index >= pool.length ? hottest : MULTI_PROVIDER_TEMPERATURE,
  }));
}

/**
 * Distinct models for the writers, spread across providers: the best model of
 * each provider first, then each provider's next model, so no two writers share
 * a model while the organization has enough of them.
 */
export function distinctModels(ctx: PipelineContext, cooling: ReadonlySet<AIProviderName> = new Set()): ProviderPreference[] {
  const everything = ctx.router.candidates("json", ctx.availableProviders);
  // A provider that is cooling down is left out while another one is open.
  const warm = everything.filter((c) => !cooling.has(c.provider));
  const all = topPerProvider(warm.length > 0 ? warm : everything, TOP_MODELS_PER_PROVIDER);
  // Models the earlier agents used are skipped while enough others remain among each provider's best.
  const inUse = ctx.modelsInUse ?? new Set<string>();
  const unused = all.filter((c) => !inUse.has(`${c.provider}::${c.model}`));
  const candidates = unused.length >= Math.min(DRAFT_LABELS.length, all.length) ? unused : all;
  const byProvider = new Map<AIProviderName, ProviderPreference[]>();
  for (const c of candidates) {
    const list = byProvider.get(c.provider) ?? [];
    if (list.length < DRAFT_LABELS.length) byProvider.set(c.provider, [...list, { provider: c.provider, model: c.model }]);
  }
  const lists = ctx.availableProviders.map((p) => byProvider.get(p) ?? []).filter((l) => l.length > 0);
  const out: ProviderPreference[] = [];
  for (let round = 0; out.length < DRAFT_LABELS.length && lists.some((l) => l.length > round); round++) {
    for (const list of lists) if (list[round] && out.length < DRAFT_LABELS.length) out.push(list[round]!);
  }
  return out.length > 0 ? out : ctx.availableProviders.map((provider) => ({ provider }));
}

/**
 * What the other writers of this account are on: the models the remaining
 * slots are planned for, plus the models and providers finished drafts
 * actually used (a failover may have moved them). A writer steers clear of
 * both so the judge compares work from different models.
 */
function siblingUsage(
  slots: readonly WriterSlot[],
  slot: WriterSlot,
  done: readonly DraftCandidate[],
): { models: string[]; providers: AIProviderName[] } {
  const planned = slots.filter((s) => s.label !== slot.label && s.pref.provider && s.pref.model).map((s) => `${s.pref.provider}::${s.pref.model}`);
  const used = done.map((d) => `${d.provider}::${d.model}`);
  return {
    models: [...new Set([...planned, ...used])],
    providers: [...new Set(done.map((d) => d.provider))],
  };
}

async function writeDraft(
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  slot: WriterSlot,
  slots: readonly WriterSlot[] = [slot],
  done: readonly DraftCandidate[] = [],
): Promise<DraftCandidate> {
  const siblings = siblingUsage(slots, slot, done);
  const { value, call } = await callJson(
    ctx,
    {
      runId: run.id,
      organizationId: run.organizationId,
      step: stepName("writer", account, slot.label),
      promptKey: "writer",
      pref: slot.pref,
      live: { label: slot.label, runAccountId: account.runAccountId, field: "text", noteField: "plan" },
      avoidModels: siblings.models,
      avoidProviders: siblings.providers,
      temperature: slot.temperature,
      expectedOutputTokens: WRITER_OUTPUT_TOKENS,
      system: withSkills(
        ctx,
        renderPrompt("writer", {
          ...accountVars(account),
          strategy: strategyText(account.strategy),
          claims: claimsText(supportedClaims(run.claims)),
          lane: WRITER_LANES[slot.label] ? `${WRITER_LANES[slot.label]!.name}: ${WRITER_LANES[slot.label]!.brief}` : "Your own best angle within the strategy.",
        }),
        run,
        account.platform,
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
    text: stripInlineClaimIds(value.text, run.claims),
    hashtags: value.hashtags,
    claimIds: filterClaimIds(value.claimIds, run.claims),
    costCents: call.costCents,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
    latencyMs: call.latencyMs,
  };
}

/**
 * DRAFTING: the writers of one account work at the same time, each on its own
 * model and lane; their drafts are saved in label order once all have answered.
 * A writer that fails only costs its own draft. Accounts go one after another.
 */
export async function writersStage(ctx: PipelineContext, run: RunSnapshot): Promise<void> {
  const slots = planWriters(ctx, await coolingProviders(ctx));
  const written = await perAccount(run.accounts, async (account) => {
    let savedForAccount = 0;
    const results = await Promise.allSettled(slots.map((slot) => writeDraft(ctx, run, account, slot, slots, [])));
    for (const [index, result] of results.entries()) {
      const slot = slots[index]!;
      if (result.status === "fulfilled") {
        await ctx.store.saveDraft(run.id, account.runAccountId, result.value);
        savedForAccount += 1;
        continue;
      }
      if (isPipelineBlocked(result.reason)) throw result.reason;
      await ctx.store.addEvent(run.id, {
        step: stepName("writer", account, slot.label),
        status: "SKIPPED",
        error: errorMessage(result.reason),
      });
    }
    if (savedForAccount === 0) {
      await ctx.store.addEvent(run.id, {
        step: stepName("writer", account),
        status: "SKIPPED",
        error: "no writer produced a usable draft for this account",
      });
    }
    return savedForAccount;
  });
  if (written.reduce((a, b) => a + b, 0) === 0) throw new PipelineBlocked("no valid drafts");
}
