import type { AIProviderName } from "@platform/types";
import type { ProviderHealthPort } from "./contracts";

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface BreakerConfig {
  /** Failures inside `windowMs` that open the breaker (spec: 5). */
  failureThreshold: number;
  /** Sliding window for counting failures (spec: 60 s). */
  windowMs: number;
  /** How long the breaker stays OPEN before allowing one probe (spec: 120 s). */
  openMs: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = { failureThreshold: 5, windowMs: 60_000, openMs: 120_000 };

/** Persistable breaker record (the Prisma-backed port stores one per provider). */
export interface BreakerRecord {
  state: BreakerState;
  /** Failure timestamps (ms) inside the window. */
  failures: readonly number[];
  /** When the breaker was opened (or half-opened), ms. */
  changedAt: number;
  /** HALF_OPEN only: a probe call has been handed out and has not reported back yet. */
  probeInFlight: boolean;
  lastError?: string;
}

export type BreakerEvent =
  | { type: "check"; at: number }
  | { type: "success"; at: number }
  | { type: "failure"; at: number; error?: string };

export interface BreakerTransition {
  record: BreakerRecord;
  /** For "check": whether callers must skip the provider right now. */
  open: boolean;
}

export const CLOSED_RECORD: BreakerRecord = { state: "CLOSED", failures: [], changedAt: 0, probeInFlight: false };

/**
 * Pure state transition shared by the in-memory breaker below and the
 * Prisma-backed `ProviderHealthPort` in the web app.
 *
 * CLOSED --(threshold failures in window)--> OPEN --(openMs elapsed, on check)--> HALF_OPEN
 * HALF_OPEN --(probe success)--> CLOSED ; HALF_OPEN --(probe failure)--> OPEN
 */
export function nextState(
  record: BreakerRecord,
  event: BreakerEvent,
  config: BreakerConfig = DEFAULT_BREAKER_CONFIG,
): BreakerTransition {
  switch (event.type) {
    case "check":
      return check(record, event.at, config);
    case "success":
      return { record: onSuccess(record, event.at), open: false };
    case "failure":
      return onFailure(record, event.at, event.error, config);
  }
}

function check(record: BreakerRecord, at: number, config: BreakerConfig): BreakerTransition {
  if (record.state === "CLOSED") return { record, open: false };
  if (record.state === "OPEN") {
    if (at - record.changedAt < config.openMs) return { record, open: true };
    return { record: { ...record, state: "HALF_OPEN", changedAt: at, probeInFlight: true }, open: false };
  }
  // HALF_OPEN: one probe at a time; a probe that never reports back expires after openMs.
  if (record.probeInFlight && at - record.changedAt < config.openMs) return { record, open: true };
  return { record: { ...record, changedAt: at, probeInFlight: true }, open: false };
}

function onSuccess(record: BreakerRecord, at: number): BreakerRecord {
  if (record.state === "HALF_OPEN") return { ...CLOSED_RECORD, changedAt: at };
  return record;
}

function onFailure(record: BreakerRecord, at: number, error: string | undefined, config: BreakerConfig): BreakerTransition {
  if (record.state === "HALF_OPEN") {
    return { record: { ...record, state: "OPEN", changedAt: at, probeInFlight: false, lastError: error }, open: true };
  }
  if (record.state === "OPEN") return { record: { ...record, lastError: error }, open: true };
  const failures = [...record.failures.filter((t) => at - t < config.windowMs), at];
  if (failures.length >= config.failureThreshold) {
    return { record: { state: "OPEN", failures, changedAt: at, probeInFlight: false, lastError: error }, open: true };
  }
  return { record: { ...record, failures, lastError: error }, open: false };
}

export interface CircuitBreaker extends ProviderHealthPort {
  isHealthy(provider: AIProviderName): Promise<boolean>;
  snapshot(provider: AIProviderName): BreakerRecord;
}

/** In-memory `ProviderHealthPort` (one record per provider) built on `nextState`. */
export function createCircuitBreaker(
  config: BreakerConfig = DEFAULT_BREAKER_CONFIG,
  now: () => number = () => Date.now(),
): CircuitBreaker {
  const records = new Map<AIProviderName, BreakerRecord>();
  const current = (provider: AIProviderName): BreakerRecord => records.get(provider) ?? CLOSED_RECORD;
  const apply = (provider: AIProviderName, event: BreakerEvent): boolean => {
    const transition = nextState(current(provider), event, config);
    records.set(provider, transition.record);
    return transition.open;
  };
  return {
    async isOpen(provider) {
      return apply(provider, { type: "check", at: now() });
    },
    async isHealthy(provider) {
      const record = current(provider);
      // Closed, or open long enough that the next call earns a probe: either way the planner may seat it.
      return record.state === "CLOSED" || now() - record.changedAt >= config.openMs;
    },
    async recordSuccess(provider) {
      apply(provider, { type: "success", at: now() });
    },
    async recordFailure(provider, error) {
      apply(provider, { type: "failure", at: now(), error });
    },
    snapshot: (provider) => current(provider),
  };
}
