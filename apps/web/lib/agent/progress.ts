/**
 * Server-side glue for the live progress view.
 *
 * The view itself is built by `buildProgress` in `@platform/agent-council`,
 * which is pure so the browser can rebuild it from streamed events. This module
 * only turns rows into the shape that helper (and the stream) speaks, so the
 * first paint from the server and every later update agree.
 *
 * Every query built on `runProgressSelect` must still be scoped by
 * `organizationId` at the call site.
 */
import type { Prisma } from "@platform/database";
import type { RunInitial } from "@/components/agent/live-progress";
import { progressOutput, type ProgressAccount, type ProgressEvent } from "@platform/agent-council/progress";

export { buildProgress, buildSummaryLine, formatDuration } from "@platform/agent-council/progress";

/** Enough recent history for the stepper; the replay screen has the full list. */
export const PROGRESS_EVENT_LIMIT = 200;

export const progressEventSelect = {
  id: true,
  step: true,
  status: true,
  provider: true,
  model: true,
  costCents: true,
  latencyMs: true,
  error: true,
  createdAt: true,
  output: true,
} satisfies Prisma.AgentRunEventSelect;

/** Everything the live view needs about one campaign, and nothing else. */
export const runProgressSelect = {
  id: true,
  topic: true,
  status: true,
  currentStep: true,
  spentCents: true,
  maxCents: true,
  startedAt: true,
  createdAt: true,
  accounts: {
    select: {
      id: true,
      platform: true,
      decision: true,
      finalText: true,
      editedText: true,
      socialAccount: { select: { displayName: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  events: {
    select: progressEventSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PROGRESS_EVENT_LIMIT,
  },
  _count: { select: { claims: true } },
} satisfies Prisma.AgentRunSelect;

export type RunProgressRow = Prisma.AgentRunGetPayload<{ select: typeof runProgressSelect }>;

export type ProgressEventRow = Prisma.AgentRunEventGetPayload<{ select: typeof progressEventSelect }>;
type EventRow = ProgressEventRow;

export function outputOf(row: Pick<EventRow, "step" | "output">): ProgressEvent["output"] {
  return progressOutput(row.step, row.output);
}

export function toProgressEvent(row: EventRow): ProgressEvent {
  const output = outputOf(row);
  return {
    id: row.id,
    step: row.step,
    status: row.status,
    provider: row.provider,
    model: row.model,
    costCents: row.costCents,
    latencyMs: row.latencyMs,
    error: row.error,
    at: row.createdAt.toISOString(),
    ...(output ? { output } : {}),
  };
}

export function toProgressAccount(row: RunProgressRow["accounts"][number]): ProgressAccount {
  return {
    runAccountId: row.id,
    displayName: row.socialAccount.displayName,
    platform: row.platform,
    decision: row.decision,
    hasRecommendation: Boolean(row.editedText ?? row.finalText),
  };
}

/**
 * The same starting point, built from a run that was already loaded in full
 * (the review screen), so the page does not query twice for the same rows.
 */
export interface RunDetailLike {
  status: string;
  currentStep: string | null;
  spentCents: number;
  maxCents: number;
  startedAt: Date | null;
  createdAt: Date;
  accounts: RunProgressRow["accounts"];
  events: readonly ProgressEventRow[];
  claims: readonly unknown[];
}

export function detailToRunInitial(run: RunDetailLike): RunInitial {
  const events = run.events.slice(-PROGRESS_EVENT_LIMIT);
  return {
    status: run.status,
    currentStep: run.currentStep,
    spentCents: run.spentCents,
    maxCents: run.maxCents,
    claimCount: run.claims.length,
    startedAt: (run.startedAt ?? run.createdAt).toISOString(),
    accounts: run.accounts.map(toProgressAccount),
    events: events.map(toProgressEvent),
  };
}

/** The server-rendered starting point handed to `<LiveProgress initial>`. */
export function toRunInitial(run: RunProgressRow): RunInitial {
  return {
    status: run.status,
    currentStep: run.currentStep,
    spentCents: run.spentCents,
    maxCents: run.maxCents,
    claimCount: run._count.claims,
    startedAt: (run.startedAt ?? run.createdAt).toISOString(),
    accounts: run.accounts.map(toProgressAccount),
    // The query reads newest-first so the `take` keeps the recent ones.
    events: [...run.events].reverse().map(toProgressEvent),
  };
}
