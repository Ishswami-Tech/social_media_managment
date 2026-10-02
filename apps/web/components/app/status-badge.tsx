import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "signal" | "ink" | "success" | "info" | "warning" | "danger" | "muted";

/**
 * One status map for the whole app: every raw enum (post, run, account,
 * event, WhatsApp) gets a plain-language label and one of seven tones.
 * Signal (orange) is reserved for "needs you".
 */
const MAP: Record<string, { label: string; tone: Tone; live?: boolean }> = {
  // Posts
  DRAFT: { label: "Draft", tone: "muted" },
  IN_REVIEW: { label: "Ready for you", tone: "signal" },
  APPROVED: { label: "Approved", tone: "info" },
  SCHEDULED: { label: "Scheduled", tone: "ink" },
  QUEUED: { label: "Scheduled", tone: "ink" },
  PUBLISHING: { label: "Posting", tone: "info", live: true },
  RETRYING: { label: "Retrying", tone: "warning" },
  PUBLISHED: { label: "Published", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
  DELETED: { label: "Deleted", tone: "muted" },
  DISCONNECTED_ACCOUNT: { label: "Account disconnected", tone: "danger" },
  // Accounts and organizations
  CONNECTED: { label: "Connected", tone: "success" },
  EXPIRED: { label: "Reconnect needed", tone: "danger" },
  DISCONNECTED: { label: "Disconnected", tone: "muted" },
  ERROR: { label: "Error", tone: "danger" },
  ACTIVE: { label: "Active", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  ARCHIVED: { label: "Archived", tone: "muted" },
  // WhatsApp
  OPEN: { label: "Open", tone: "success" },
  PENDING: { label: "Pending", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "muted" },
  SENT: { label: "Sent", tone: "muted" },
  DELIVERED: { label: "Delivered", tone: "muted" },
  READ: { label: "Read", tone: "success" },
  RECEIVED: { label: "Received", tone: "muted" },
  // Media, jobs, webhooks
  READY: { label: "Ready", tone: "success" },
  PROCESSING: { label: "Processing", tone: "info", live: true },
  UPLOADED: { label: "Uploaded", tone: "muted" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  RUNNING: { label: "Running", tone: "info", live: true },
  COMPLETED: { label: "Done", tone: "success" },
  PROCESSED: { label: "Processed", tone: "success" },
  IGNORED: { label: "Ignored", tone: "muted" },
  // Agent Council run pipeline (AgentRunStatus)
  RESEARCHING: { label: "Researching", tone: "info", live: true },
  STRATEGIZING: { label: "Choosing angles", tone: "info", live: true },
  DRAFTING: { label: "Writing", tone: "info", live: true },
  REVIEWING: { label: "Checking", tone: "info", live: true },
  JUDGING: { label: "Judging", tone: "info", live: true },
  ADAPTING: { label: "Polishing", tone: "info", live: true },
  AWAITING_APPROVAL: { label: "Ready for you", tone: "signal" },
  PAUSED: { label: "Paused", tone: "warning" },
  BLOCKED: { label: "Blocked", tone: "warning" },
  // Per-account decision and claim ledger
  REJECTED: { label: "Rejected", tone: "danger" },
  SUPPORTED: { label: "Supported", tone: "success" },
  UNSUPPORTED: { label: "Unsupported", tone: "danger" },
  UNVERIFIED: { label: "Unverified", tone: "warning" },
  // Run events
  STARTED: { label: "Started", tone: "info", live: true },
  SKIPPED: { label: "Skipped", tone: "muted" },
};

const VARIANT = {
  signal: "signal",
  ink: "secondary",
  success: "success",
  info: "info",
  warning: "warning",
  danger: "danger",
  muted: "muted",
} as const;

/** Plain-language label for a raw status enum. */
export function statusLabel(status: string): string {
  return MAP[status]?.label ?? status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** The tone a status renders in, for callers that colour something other than a pill. */
export function statusTone(status: string): Tone {
  return MAP[status]?.tone ?? "muted";
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const entry = MAP[status];
  const tone = entry?.tone ?? "muted";
  return (
    <Badge variant={VARIANT[tone]} className={cn("gap-1.5", className)} title={status}>
      {entry?.live ? (
        <span aria-hidden className="live-dot size-1.5 rounded-full bg-current" />
      ) : tone !== "muted" && tone !== "ink" ? (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      ) : null}
      {statusLabel(status)}
    </Badge>
  );
}
