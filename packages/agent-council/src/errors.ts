/**
 * Raised when the pipeline cannot continue without a human (budget denied,
 * providers unavailable, no valid drafts, final checks failing). The worker
 * moves the run to BLOCKED with `reason`; any other error is treated as
 * retryable (FAILED → QUEUED).
 */
export class PipelineBlocked extends Error {
  override readonly name = "PipelineBlocked";

  constructor(
    public readonly reason: string,
    public readonly details?: unknown,
  ) {
    super(reason);
  }
}

export function isPipelineBlocked(error: unknown): error is PipelineBlocked {
  return error instanceof PipelineBlocked || (error instanceof Error && error.name === "PipelineBlocked");
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unexpected error";
}
