import type { AgentRunStatus } from "@platform/types";

/**
 * Plain-language wording for every state a draft can be in. The underlying
 * states are technical; people only ever see these.
 *
 * Shared by the home screen, the review screen and the live progress view so
 * one status never reads two different ways in two places.
 */
export const STATUS_LABELS: Record<AgentRunStatus, string> = {
  QUEUED: "Getting started…",
  RESEARCHING: "Researching…",
  STRATEGIZING: "Planning the angle…",
  DRAFTING: "Writing drafts…",
  REVIEWING: "Checking the facts…",
  JUDGING: "Judging…",
  ADAPTING: "Adapting…",
  AWAITING_APPROVAL: "Ready for your review",
  APPROVED: "Getting ready to publish…",
  PUBLISHING: "Publishing…",
  COMPLETED: "Done",
  FAILED: "Something went wrong",
  PAUSED: "Paused",
  BLOCKED: "Needs your attention",
  CANCELLED: "Stopped",
};

/** Shorter wording for a chip or a one-line card. */
export const SHORT_STATUS_LABELS: Record<AgentRunStatus, string> = {
  QUEUED: "Starting",
  RESEARCHING: "Researching",
  STRATEGIZING: "Planning",
  DRAFTING: "Writing",
  REVIEWING: "Checking",
  JUDGING: "Judging",
  ADAPTING: "Adapting",
  AWAITING_APPROVAL: "Ready",
  APPROVED: "Approved",
  PUBLISHING: "Publishing",
  COMPLETED: "Done",
  FAILED: "Failed",
  PAUSED: "Paused",
  BLOCKED: "Blocked",
  CANCELLED: "Stopped",
};

/** States where work is still happening, so the screen should keep refreshing. */
export const IN_PROGRESS_STATUSES: readonly AgentRunStatus[] = [
  "QUEUED",
  "RESEARCHING",
  "STRATEGIZING",
  "DRAFTING",
  "REVIEWING",
  "JUDGING",
  "ADAPTING",
  "APPROVED",
  "PUBLISHING",
];

/**
 * States where the worker has stopped touching the campaign: either it wants a
 * person, or there is nothing left to do. The live stream closes here and the
 * page swaps from the flow to the result.
 */
export const SETTLED_STATUSES: readonly AgentRunStatus[] = [
  "AWAITING_APPROVAL",
  "APPROVED",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "PAUSED",
];

/** States where there is a recommendation worth showing. */
export const READY_STATUSES: readonly AgentRunStatus[] = ["AWAITING_APPROVAL", "APPROVED", "PUBLISHING", "COMPLETED"];

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as AgentRunStatus] ?? "In progress…";
}

export function shortStatusLabel(status: string): string {
  return SHORT_STATUS_LABELS[status as AgentRunStatus] ?? "Working";
}

export function isInProgress(status: string): boolean {
  return IN_PROGRESS_STATUSES.includes(status as AgentRunStatus);
}

export function isSettled(status: string): boolean {
  return SETTLED_STATUSES.includes(status as AgentRunStatus);
}

/** True once the person has something to read (and the live flow can collapse). */
export function isReady(status: string): boolean {
  return READY_STATUSES.includes(status as AgentRunStatus);
}

/**
 * States where the campaign is still being produced, so there is nothing to
 * read yet and the recommendation stays hidden.
 */
export const PRODUCING_STATUSES: readonly AgentRunStatus[] = [
  "QUEUED",
  "RESEARCHING",
  "STRATEGIZING",
  "DRAFTING",
  "REVIEWING",
  "JUDGING",
  "ADAPTING",
];

/** True while the flow of work is worth watching live. */
export const LIVE_FLOW_STATUSES: readonly AgentRunStatus[] = [
  ...PRODUCING_STATUSES,
  "PUBLISHING",
  "PAUSED",
  "BLOCKED",
  "FAILED",
];

export function isProducing(status: string): boolean {
  return PRODUCING_STATUSES.includes(status as AgentRunStatus);
}

export function showsLiveFlow(status: string): boolean {
  return LIVE_FLOW_STATUSES.includes(status as AgentRunStatus);
}
