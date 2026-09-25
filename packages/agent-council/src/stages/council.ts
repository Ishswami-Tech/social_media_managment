/**
 * A council of models behind one seat: the researcher asks three models and
 * merges what they found, the strategist hears three angles and keeps the
 * strongest, the reviewer pools three readings, the judge is three judges
 * voting. `councilSize` on the context says how many; 1 (the default, and
 * what the tests use) is a single call as before.
 */
import type { AIProviderName } from "@platform/types";
import type { PipelineContext } from "../contracts";
import { COUNCIL_PERSPECTIVES, type ProgressStageKey } from "../progress";
import { errorMessage, isPipelineBlocked } from "../errors";
import type { ProviderPreference } from "./call";

/**
 * Up to `councilSize` distinct models for one seat, spread across providers
 * (each provider's best model first, then their next ones), skipping models
 * the caller rules out, models known to be dead, providers that are cooling
 * down, and models earlier agents used while enough others remain. A lone
 * `{}` when the council is one seat, so routing and failover apply untouched.
 */
export async function councilPrefs(ctx: PipelineContext, avoid: ReadonlySet<string> = new Set()): Promise<ProviderPreference[]> {
  const size = Math.max(1, ctx.councilSize ?? 1);
  if (size === 1) return [{}];
  const dead = ctx.deadModels ?? new Set<string>();
  const inUse = ctx.modelsInUse ?? new Set<string>();
  const cooling = await coolingProviders(ctx);
  const usable: { provider: AIProviderName; model: string }[] = [];
  for (const c of ctx.router.candidates("json", ctx.availableProviders)) {
    const key = `${c.provider}::${c.model}`;
    if (avoid.has(key) || dead.has(key) || cooling.has(c.provider)) continue;
    usable.push({ provider: c.provider, model: c.model });
  }
  // Rotation stays within each provider's best few: a seat is never handed a model nobody would pick on purpose.
  const top = topPerProvider(usable, TOP_MODELS_PER_PROVIDER);
  const fresh = top.filter((c) => !inUse.has(`${c.provider}::${c.model}`));
  const picked = spread(fresh.length >= size ? fresh : top, ctx.availableProviders, size);
  return picked.length > 0 ? picked : [{}];
}

/** How deep into a provider's catalogue rotation may go before it reuses the best models instead. */
export const TOP_MODELS_PER_PROVIDER = 6;

/** The first `limit` candidates of each provider, in the order given. */
export function topPerProvider<T extends { provider: AIProviderName }>(candidates: readonly T[], limit: number): T[] {
  const seen = new Map<AIProviderName, number>();
  return candidates.filter((c) => {
    const n = seen.get(c.provider) ?? 0;
    if (n >= limit) return false;
    seen.set(c.provider, n + 1);
    return true;
  });
}

/**
 * Providers whose breaker is not closed right now, read without touching the
 * breaker. A port without `isHealthy` reports none, so nothing is skipped.
 */
export async function coolingProviders(ctx: PipelineContext): Promise<Set<AIProviderName>> {
  const cooling = new Set<AIProviderName>();
  if (!ctx.health.isHealthy) return cooling;
  for (const provider of ctx.availableProviders) {
    if (!(await ctx.health.isHealthy(provider))) cooling.add(provider);
  }
  return cooling;
}

/** Round-robin across providers in the organization's order: best of each, then the next of each. */
function spread(candidates: readonly { provider: AIProviderName; model: string }[], providers: readonly AIProviderName[], size: number): ProviderPreference[] {
  const byProvider = new Map<AIProviderName, ProviderPreference[]>();
  for (const c of candidates) byProvider.set(c.provider, [...(byProvider.get(c.provider) ?? []), { provider: c.provider, model: c.model }]);
  const lists = providers.map((p) => byProvider.get(p) ?? []).filter((l) => l.length > 0);
  const out: ProviderPreference[] = [];
  for (let round = 0; out.length < size && lists.some((l) => l.length > round); round++) {
    for (const list of lists) if (list[round] && out.length < size) out.push(list[round]!);
  }
  return out;
}

/**
 * The instruction that makes seat `index` of a council look at the question
 * its own way; nothing for a single seat, so a lone call keeps its prompt.
 */
export function seatPerspective(stage: ProgressStageKey, index: number, seats: number): string | undefined {
  if (seats < 2) return undefined;
  const list = COUNCIL_PERSPECTIVES[stage];
  const p = list?.[index % (list?.length || 1)];
  return p ? `YOUR SEAT ON THE COUNCIL: ${p.name}. ${p.brief} Other seats cover the other perspectives; do not water yours down.` : undefined;
}

/** The user message with the seat's perspective appended, when there is one. */
export function withPerspective(user: string, perspective: string | undefined): string {
  return perspective ? `${user}\n${perspective}` : user;
}

/** A `council` failure hook that writes a FAILED event on the seat's own step. */
export function recordSeatFailure(ctx: PipelineContext, runId: string, step: string, seats: number) {
  return async (index: number, error: unknown): Promise<void> => {
    await ctx.store.addEvent(runId, { step: seatStep(step, index, seats), status: "FAILED", error: errorMessage(error) });
  };
}

/** "PROVIDER::model" keys of every other seat, so a seat that fails over still steers clear of its colleagues. */
export function otherSeats(prefs: readonly ProviderPreference[], index: number): string[] {
  return prefs.flatMap((p, i) => (i !== index && p.provider && p.model ? [`${p.provider}::${p.model}`] : []));
}

/**
 * Runs one attempt per preference at the same time and returns those that
 * answered. A blocked pipeline (budget, no provider) stops everything; any
 * other failure only costs that seat. Nothing answered: the first error is
 * thrown, so the caller sees why.
 */
export async function council<T>(
  prefs: readonly ProviderPreference[],
  attempt: (pref: ProviderPreference, index: number, others: string[]) => Promise<T>,
  /** Called for a seat that failed while others answered, so the loss is on the record rather than silent. */
  onFailed?: (index: number, error: unknown) => Promise<void>,
): Promise<T[]> {
  const results = await Promise.allSettled(prefs.map((pref, index) => attempt(pref, index, otherSeats(prefs, index))));
  const answered: T[] = [];
  let firstError: unknown;
  const failed: { index: number; error: unknown }[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      answered.push(result.value);
      return;
    }
    failed.push({ index, error: result.reason });
    firstError ??= result.reason;
  });
  const blocked = failed.find((f) => isPipelineBlocked(f.error));
  if (blocked) throw blocked.error;
  if (answered.length > 0 && onFailed) {
    for (const f of failed) await onFailed(f.index, f.error).catch(() => undefined);
  }
  if (answered.length === 0) throw firstError ?? new Error("no model answered");
  return answered;
}

/**
 * The replay step for one seat of a council: "strategy:acc_1:m2" for the
 * second of three, the plain step when the council is one seat. Distinct
 * names keep each seat's events and live text apart on the board.
 */
export function seatStep(step: string, index: number, seats: number): string {
  return seats > 1 ? `${step}:m${index + 1}` : step;
}

/** Case-insensitive union that keeps first spellings and order. */
export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}
