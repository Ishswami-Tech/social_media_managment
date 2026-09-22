"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ConnectButtons({ linkedin, meta }: { linkedin: boolean; meta: boolean }) {
  return (
    <div className="flex gap-2">
      <Button asChild variant={linkedin ? "default" : "outline"} disabled={!linkedin}>
        <a
          href={linkedin ? "/api/oauth/linkedin/start" : undefined}
          title={linkedin ? undefined : "Set LINKEDIN_CLIENT_ID/SECRET"}
        >
          Connect LinkedIn
        </a>
      </Button>
      <Button asChild variant={meta ? "default" : "outline"} disabled={!meta}>
        <a href={meta ? "/api/oauth/meta/start" : undefined} title={meta ? undefined : "Set META_APP_ID/SECRET"}>
          Connect Facebook / Instagram
        </a>
      </Button>
    </div>
  );
}

export function AccountActions({
  id,
  platform,
  requireApproval,
  status,
}: {
  id: string;
  platform: string;
  requireApproval: boolean | null;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(value: boolean | null) {
    setBusy(true);
    const res = await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireApproval: value }),
    });
    setBusy(false);
    if (!res.ok) return toast.error("Update failed");
    toast.success("Approval setting updated");
    router.refresh();
  }

  async function disconnect() {
    if (!confirm("Disconnect this account? Scheduled posts for it will be paused.")) return;
    setBusy(true);
    const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error("Disconnect failed");
    toast.success("Account disconnected");
    router.refresh();
  }

  const reconnectHref = platform === "LINKEDIN" ? "/api/oauth/linkedin/start" : "/api/oauth/meta/start";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={busy}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {status !== "CONNECTED" && (
          <DropdownMenuItem asChild>
            <a href={reconnectHref}>Reconnect</a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => patch(null)} disabled={requireApproval === null}>
          Use organization approval default
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => patch(true)} disabled={requireApproval === true}>
          Always require approval
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => patch(false)} disabled={requireApproval === false}>
          Never require approval
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={disconnect}>
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Lets the Agent Council publish to this account without a human. It only has
 * an effect when the organization publishing mode is AUTOMATIC.
 */
export function AgentAutoPublishSwitch({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(enabled);

  async function change(value: boolean) {
    setBusy(true);
    setOn(value);
    const res = await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentAutoPublish: value }),
    });
    setBusy(false);
    if (!res.ok) {
      setOn(!value);
      return toast.error("Update failed");
    }
    toast.success(value ? "Campaigns may publish to this account" : "Campaigns now need approval for this account");
    router.refresh();
  }

  return (
    <Switch
      checked={on}
      onCheckedChange={change}
      disabled={busy}
      aria-label="Auto-publish by campaigns"
      title="Auto-publish by campaigns"
    />
  );
}
