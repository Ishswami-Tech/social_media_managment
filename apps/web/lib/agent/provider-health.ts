import type { ProviderHealthPort } from "@platform/agent-council";
import type { CircuitState } from "@platform/database";
import type { AIProviderName } from "@platform/types";
import { prisma } from "@/lib/db";

/**
 * Circuit breaker persisted in `ProviderHealth` (one row per provider) so every
 * worker process shares the same view of a failing provider.
 *
 *   CLOSED --(5 failures within 60 s)--> OPEN (120 s) --(window elapsed, on check)--> HALF_OPEN
 *   HALF_OPEN: one probe is handed out; success -> CLOSED, failure -> OPEN again.
 *
 * The failure window is approximated with `failureCount` + `lastFailureAt`
 * (the counter resets when the last failure is older than the window).
 */

export interface BreakerConfig {
  failureThreshold: number;
  windowMs: number;
  openMs: number;
  /** EMA weight of the newest latency sample. */
  latencyAlpha: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = {
  failureThreshold: 5,
  windowMs: 60_000,
  openMs: 120_000,
  latencyAlpha: 0.2,
};

/** Mirrors the mutable columns of `ProviderHealth`. */
export interface BreakerRecord {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  avgLatencyMs: number;
  lastFailureAt: Date | null;
  lastError: string | null;
  /** OPEN: when the breaker may hand out a probe. HALF_OPEN: when an unreported probe expires. */
  openedUntil: Date | null;
}

export const CLOSED_RECORD: BreakerRecord = {
  state: "CLOSED",
  failureCount: 0,
  successCount: 0,
  avgLatencyMs: 0,
  lastFailureAt: null,
  lastError: null,
  openedUntil: null,
};

export type BreakerEvent =
  | { type: "check"; at: Date }
  | { type: "success"; at: Date; latencyMs: number }
  | { type: "failure"; at: Date; error: string };

export interface BreakerTransition {
  record: BreakerRecord;
  /** Whether callers must skip the provider right now. */
  open: boolean;
  /** False when the record is unchanged and no write is needed. */
  changed: boolean;
}

export function nextBreakerState(
  record: BreakerRecord,
  event: BreakerEvent,
  config: BreakerConfig = DEFAULT_BREAKER_CONFIG,
): BreakerTransition {
  switch (event.type) {
    case "check":
      return check(record, event.at, config);
    case "success":
      return onSuccess(record, event.latencyMs, config);
    case "failure":
      return onFailure(record, event.at, event.error, config);
  }
}

function deadlinePassed(record: BreakerRecord, at: Date): boolean {
  return !record.openedUntil || record.openedUntil.getTime() <= at.getTime();
}

function check(record: BreakerRecord, at: Date, config: BreakerConfig): BreakerTransition {
  if (record.state === "CLOSED") return { record, open: false, changed: false };
  if (!deadlinePassed(record, at)) return { record, open: true, changed: false };
  // OPEN window elapsed, or a HALF_OPEN probe never reported back: hand out one probe.
  return {
    record: { ...record, state: "HALF_OPEN", openedUntil: new Date(at.getTime() + config.openMs) },
    open: false,
    changed: true,
  };
}

export function emaLatency(current: number, sample: number, alpha: number): number {
  if (!Number.isFinite(sample) || sample < 0) return current;
  if (current <= 0) return Math.round(sample);
  return Math.round(current * (1 - alpha) + sample * alpha);
}

function onSuccess(record: BreakerRecord, latencyMs: number, config: BreakerConfig): BreakerTransition {
  return {
    record: {
      ...record,
      state: "CLOSED",
      failureCount: 0,
      successCount: record.successCount + 1,
      avgLatencyMs: emaLatency(record.avgLatencyMs, latencyMs, config.latencyAlpha),
      openedUntil: null,
    },
    open: false,
    changed: true,
  };
}

function onFailure(record: BreakerRecord, at: Date, error: string, config: BreakerConfig): BreakerTransition {
  const insideWindow = record.lastFailureAt !== null && at.getTime() - record.lastFailureAt.getTime() <= config.windowMs;
  const failureCount = insideWindow ? record.failureCount + 1 : 1;
  const base = { ...record, failureCount, lastFailureAt: at, lastError: error };
  const trip = record.state === "HALF_OPEN" || failureCount >= config.failureThreshold;
  if (trip) {
    return { record: { ...base, state: "OPEN", openedUntil: new Date(at.getTime() + config.openMs) }, open: true, changed: true };
  }
  if (record.state === "OPEN") return { record: base, open: true, changed: true };
  return { record: base, open: false, changed: true };
}

function toRecord(row: BreakerRecord | null): BreakerRecord {
  return row ?? CLOSED_RECORD;
}

async function apply(provider: AIProviderName, event: BreakerEvent, config: BreakerConfig): Promise<boolean> {
  const row = await prisma.providerHealth.findUnique({
    where: { provider },
    select: {
      state: true,
      failureCount: true,
      successCount: true,
      avgLatencyMs: true,
      lastFailureAt: true,
      lastError: true,
      openedUntil: true,
    },
  });
  const transition = nextBreakerState(toRecord(row), event, config);
  if (transition.changed) {
    await prisma.providerHealth.upsert({
      where: { provider },
      create: { provider, ...transition.record },
      update: transition.record,
    });
  }
  return transition.open;
}

export function createPrismaProviderHealth(
  config: BreakerConfig = DEFAULT_BREAKER_CONFIG,
  now: () => Date = () => new Date(),
): ProviderHealthPort {
  return {
    isOpen: (provider) => apply(provider, { type: "check", at: now() }, config),
    recordSuccess: async (provider, latencyMs) => {
      await apply(provider, { type: "success", at: now(), latencyMs }, config);
    },
    recordFailure: async (provider, error) => {
      await apply(provider, { type: "failure", at: now(), error: error.slice(0, 500) }, config);
    },
  };
}

export interface ProviderHealthSummary {
  provider: string;
  state: CircuitState;
  /** Whether calls are being refused at this moment. */
  open: boolean;
  failureCount: number;
  successCount: number;
  avgLatencyMs: number;
  lastFailureAt: string | null;
  lastError: string | null;
  openedUntil: string | null;
  updatedAt: string;
}

/** Read-only view for the admin UI (no state transitions are performed). */
export async function providerHealthSummary(now: Date = new Date()): Promise<ProviderHealthSummary[]> {
  const rows = await prisma.providerHealth.findMany({ orderBy: { provider: "asc" } });
  return rows.map((r) => ({
    provider: r.provider,
    state: r.state,
    open: r.state !== "CLOSED" && !deadlinePassed(r, now),
    failureCount: r.failureCount,
    successCount: r.successCount,
    avgLatencyMs: r.avgLatencyMs,
    lastFailureAt: r.lastFailureAt?.toISOString() ?? null,
    lastError: r.lastError,
    openedUntil: r.openedUntil?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}
