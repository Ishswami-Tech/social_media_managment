export const POST_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "QUEUED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "RETRYING",
  "CANCELLED",
  "DISCONNECTED_ACCOUNT",
  "DELETED",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const APPROVAL_STATUSES = ["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const PUBLISH_JOB_STATUSES = ["PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type PublishJobStatus = (typeof PUBLISH_JOB_STATUSES)[number];

/**
 * Allowed post state transitions (section 13 of the spec). Anything not listed
 * here is rejected by the domain layer.
 */
export const POST_TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  DRAFT: ["IN_REVIEW", "APPROVED", "SCHEDULED", "CANCELLED"],
  IN_REVIEW: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["SCHEDULED", "QUEUED", "DRAFT", "CANCELLED"],
  SCHEDULED: ["QUEUED", "DRAFT", "CANCELLED"],
  QUEUED: ["PUBLISHING", "SCHEDULED", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "FAILED", "RETRYING", "DISCONNECTED_ACCOUNT"],
  RETRYING: ["PUBLISHING", "FAILED", "CANCELLED"],
  FAILED: ["SCHEDULED", "QUEUED", "DRAFT", "CANCELLED"],
  DISCONNECTED_ACCOUNT: ["SCHEDULED", "DRAFT", "CANCELLED"],
  /** Removed from the platform by the organization after publishing. */
  PUBLISHED: ["DELETED"],
  CANCELLED: ["DRAFT"],
  DELETED: [],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return POST_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: PostStatus,
    public readonly to: PostStatus,
  ) {
    super(`Invalid post status transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: PostStatus, to: PostStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
