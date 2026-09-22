import type { AgentRunStatus } from "@platform/types";

/**
 * Plain-language wording for every state a draft can be in. The underlying
 * states are technical; people only ever see these.
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

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as AgentRunStatus] ?? "In progress…";
}
