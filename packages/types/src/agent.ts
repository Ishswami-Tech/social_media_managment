/**
 * Agent Council run lifecycle. The run is a persistent state machine driven by
 * the worker; every transition goes through `assertRunTransition`. PAUSED and
 * BLOCKED are side states: the status to return to is stored on the run.
 */
export const AGENT_RUN_STATUSES = [
  "QUEUED",
  "RESEARCHING",
  "STRATEGIZING",
  "DRAFTING",
  "REVIEWING",
  "JUDGING",
  "ADAPTING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "PUBLISHING",
  "COMPLETED",
  "FAILED",
  "PAUSED",
  "BLOCKED",
  "CANCELLED",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** Pipeline stages in execution order (statuses the worker advances through). */
export const AGENT_PIPELINE: readonly AgentRunStatus[] = [
  "RESEARCHING",
  "STRATEGIZING",
  "DRAFTING",
  "REVIEWING",
  "JUDGING",
  "ADAPTING",
] as const;

const PAUSABLE: readonly AgentRunStatus[] = ["QUEUED", ...AGENT_PIPELINE, "AWAITING_APPROVAL", "APPROVED"];

export const AGENT_RUN_TRANSITIONS: Record<AgentRunStatus, readonly AgentRunStatus[]> = {
  QUEUED: ["RESEARCHING", "PAUSED", "BLOCKED", "CANCELLED", "FAILED"],
  RESEARCHING: ["STRATEGIZING", "PAUSED", "BLOCKED", "CANCELLED", "FAILED"],
  STRATEGIZING: ["DRAFTING", "PAUSED", "BLOCKED", "CANCELLED", "FAILED"],
  DRAFTING: ["REVIEWING", "PAUSED", "BLOCKED", "CANCELLED", "FAILED"],
  REVIEWING: ["JUDGING", "PAUSED", "BLOCKED", "CANCELLED", "FAILED"],
  JUDGING: ["ADAPTING", "PAUSED", "BLOCKED", "CANCELLED", "FAILED"],
  ADAPTING: ["AWAITING_APPROVAL", "APPROVED", "PAUSED", "BLOCKED", "CANCELLED", "FAILED"],
  AWAITING_APPROVAL: ["APPROVED", "PAUSED", "BLOCKED", "CANCELLED", "FAILED", "COMPLETED"],
  APPROVED: ["PUBLISHING", "PAUSED", "BLOCKED", "CANCELLED", "FAILED"],
  PUBLISHING: ["COMPLETED", "BLOCKED", "FAILED"],
  COMPLETED: [],
  FAILED: ["QUEUED"],
  PAUSED: [...PAUSABLE, "CANCELLED"],
  BLOCKED: [...PAUSABLE, "PUBLISHING", "CANCELLED", "FAILED"],
  CANCELLED: [],
};

export function canRunTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return AGENT_RUN_TRANSITIONS[from].includes(to);
}

export class InvalidRunTransitionError extends Error {
  constructor(
    public readonly from: AgentRunStatus,
    public readonly to: AgentRunStatus,
  ) {
    super(`Invalid agent run transition ${from} -> ${to}`);
    this.name = "InvalidRunTransitionError";
  }
}

export function assertRunTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!canRunTransition(from, to)) throw new InvalidRunTransitionError(from, to);
}

/** Next pipeline stage after `status`, or undefined when the pipeline is finished. */
export function nextPipelineStage(status: AgentRunStatus): AgentRunStatus | undefined {
  if (status === "QUEUED") return AGENT_PIPELINE[0];
  const i = AGENT_PIPELINE.indexOf(status);
  return i >= 0 ? AGENT_PIPELINE[i + 1] : undefined;
}

export const AGENT_ASSURANCE_LEVELS = ["JUDGE_ONLY", "HIGH_ASSURANCE"] as const;
export type AgentAssurance = (typeof AGENT_ASSURANCE_LEVELS)[number];

export const AGENT_PUBLISH_MODES = ["MANUAL", "APPROVAL_REQUIRED", "AUTOMATIC"] as const;
export type AgentPublishMode = (typeof AGENT_PUBLISH_MODES)[number];

export const AGENT_DRAFT_ROLES = ["WRITER", "REVISION", "SYNTHESIS", "ADAPTATION"] as const;
export type AgentDraftRole = (typeof AGENT_DRAFT_ROLES)[number];

export const CLAIM_STATUSES = ["SUPPORTED", "UNSUPPORTED", "UNVERIFIED"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
