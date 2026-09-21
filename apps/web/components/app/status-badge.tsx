import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  DRAFT: "outline",
  IN_REVIEW: "warning",
  APPROVED: "secondary",
  SCHEDULED: "secondary",
  QUEUED: "secondary",
  PUBLISHING: "warning",
  RETRYING: "warning",
  PUBLISHED: "success",
  FAILED: "destructive",
  CANCELLED: "outline",
  DELETED: "outline",
  DISCONNECTED_ACCOUNT: "destructive",
  CONNECTED: "success",
  EXPIRED: "destructive",
  DISCONNECTED: "outline",
  ERROR: "destructive",
  ACTIVE: "success",
  SUSPENDED: "destructive",
  ARCHIVED: "outline",
  OPEN: "success",
  PENDING: "warning",
  RESOLVED: "secondary",
  SENT: "secondary",
  DELIVERED: "secondary",
  READ: "success",
  RECEIVED: "outline",
  READY: "success",
  PROCESSING: "warning",
  UPLOADED: "secondary",
  SUCCEEDED: "success",
  RUNNING: "warning",
  COMPLETED: "success",
  PROCESSED: "success",
  IGNORED: "outline",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STYLES[status] ?? "outline"}>{status.replaceAll("_", " ").toLowerCase()}</Badge>;
}
