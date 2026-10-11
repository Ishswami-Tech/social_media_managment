"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DeletePostButton } from "@/components/forms/delete-post-button";

interface Props {
  post: {
    id: string;
    status: string;
    approvalStatus: string;
    scheduledAt: string | null;
    timezone: string;
    createdById: string;
    autoPublishOnApproval: boolean;
  };
  needsApproval: boolean;
  permissions: {
    canPublish: boolean;
    canApprove: boolean;
    canEdit: boolean;
    canDelete: boolean;
    isOwnPost: boolean;
    isAdmin: boolean;
  };
}

function toLocalInput(iso: string | null) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostActions({ post, needsApproval, permissions }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState(toLocalInput(post.scheduledAt));
  const [comment, setComment] = useState("");

  async function call(path: string, body?: unknown) {
    setBusy(true);
    const res = await fetch(`/api/posts/${post.id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.message ?? "Action failed");
    toast.success("Done");
    router.refresh();
  }

  const s = post.status;
  const canSubmit = permissions.canEdit && s === "DRAFT" && needsApproval;
  const canReview = permissions.canApprove && s === "IN_REVIEW" && (!permissions.isOwnPost || permissions.isAdmin);
  const canSchedule =
    permissions.canPublish &&
    permissions.canEdit &&
    ["DRAFT", "APPROVED", "SCHEDULED", "QUEUED", "FAILED", "DISCONNECTED_ACCOUNT"].includes(s) &&
    (!needsApproval || post.approvalStatus === "APPROVED");
  const canCancel = permissions.canEdit && ["SCHEDULED", "QUEUED", "IN_REVIEW", "APPROVED", "RETRYING"].includes(s);
  const canUnpublish = permissions.canPublish && s === "PUBLISHED";

  async function unpublish() {
    if (!window.confirm("Remove this post from the connected platform(s)? This cannot be undone.")) return;
    setBusy(true);
    const res = await fetch(`/api/posts/${post.id}/unpublish`, { method: "POST" });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as { message?: string; failures?: string[] };
    if (!res.ok) return toast.error(data.message ?? "Could not remove the post");
    if (data.failures?.length) toast.warning(data.failures.join("; "));
    else toast.success("Removed from platform");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {needsApproval && post.approvalStatus !== "APPROVED" && s === "DRAFT" && (
          <p className="text-xs text-muted-foreground">This post requires approval before it can be scheduled.</p>
        )}
        {canSubmit && (
          <Button onClick={() => call("submit")} disabled={busy}>
            Submit for approval
          </Button>
        )}
        {canReview && (
          <div className="grid gap-2">
            <p className="text-xs text-muted-foreground">
              {post.autoPublishOnApproval
                ? post.scheduledAt
                  ? `Approving publishes this post automatically at ${new Date(post.scheduledAt).toLocaleString()}.`
                  : "Approving publishes this post immediately."
                : "Approving marks the post ready; someone with publish rights schedules it."}
            </p>
            <Textarea
              placeholder="Optional comment for the author"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => call("review", { decision: "APPROVED", comment: comment || undefined })}
                disabled={busy}
              >
                Approve
              </Button>
              <Button
                className="flex-1"
                variant="destructive"
                onClick={() => call("review", { decision: "REJECTED", comment: comment || undefined })}
                disabled={busy}
              >
                Reject
              </Button>
            </div>
          </div>
        )}
        {canSchedule && (
          <div className="grid gap-2">
            <Label htmlFor="when">Schedule for</Label>
            <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() =>
                  call("schedule", {
                    scheduledAt: new Date(when).toISOString(),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  })
                }
                disabled={busy}
              >
                {s === "SCHEDULED" || s === "QUEUED" ? "Reschedule" : "Schedule"}
              </Button>
              <Button className="flex-1" variant="secondary" onClick={() => call("publish")} disabled={busy}>
                Publish now
              </Button>
            </div>
          </div>
        )}
        {canCancel && (
          <Button variant="outline" onClick={() => call("cancel")} disabled={busy}>
            Cancel
          </Button>
        )}
        {canUnpublish && (
          <Button variant="destructive" onClick={unpublish} disabled={busy}>
            Remove from platform
          </Button>
        )}
        {permissions.canEdit && ["DRAFT", "FAILED", "CANCELLED"].includes(s) && (
          <Button variant="outline" onClick={() => router.push(`/create?edit=${post.id}`)}>
            Edit content
          </Button>
        )}
        {permissions.canDelete && (
          <DeletePostButton
            postId={post.id}
            status={s}
            canRemoveFromPlatforms={permissions.canPublish}
            redirectTo="/posts"
          />
        )}
        {!canSubmit && !canReview && !canSchedule && !canCancel && !canUnpublish && !permissions.canDelete && (
          <p className="text-sm text-muted-foreground">No actions available for your role in this state.</p>
        )}
      </CardContent>
    </Card>
  );
}
