"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AgentAssurance, AgentPublishMode } from "@platform/types";
import { formatCents } from "@/components/agent/format";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface CampaignAccount {
  id: string;
  platform: string;
  displayName: string;
  username: string | null;
  agentAutoPublish: boolean;
}

interface Props {
  accounts: CampaignAccount[];
  defaults: { assurance: AgentAssurance; publishMode: AgentPublishMode; maxCents: number; timezone: string };
  /** AUTOMATIC is only offered when the org mode is AUTOMATIC and the member can publish. */
  canAutomatic: boolean;
}

interface CreateResponse {
  run?: { id: string };
  message?: string;
}

const MAX_ACCOUNTS = 10;

export function AgentCampaignForm({ accounts, defaults, canAutomatic }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [assurance, setAssurance] = useState<AgentAssurance>(defaults.assurance);
  const [publishMode, setPublishMode] = useState<AgentPublishMode>(
    defaults.publishMode === "AUTOMATIC" && !canAutomatic ? "APPROVAL_REQUIRED" : defaults.publishMode,
  );
  const [scheduledAt, setScheduledAt] = useState("");
  const [maxCents, setMaxCents] = useState(String(defaults.maxCents));

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const parsedMaxCents = Number(maxCents);
  const maxCentsValid = Number.isInteger(parsedMaxCents) && parsedMaxCents >= 1 && parsedMaxCents <= 100_000;
  const ready =
    topic.trim().length >= 3 &&
    goal.trim().length >= 3 &&
    selected.length > 0 &&
    selected.length <= MAX_ACCOUNTS &&
    maxCentsValid;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    const body = {
      topic: topic.trim(),
      goal: goal.trim(),
      ...(audience.trim() ? { audience: audience.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      socialAccountIds: selected,
      assurance,
      publishMode,
      ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || defaults.timezone,
      maxCents: parsedMaxCents,
    };
    const res = await fetch("/api/agent/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as CreateResponse;
    if (!res.ok || !data.run) {
      setBusy(false);
      toast.error(data.message ?? "Could not start the campaign");
      return;
    }
    toast.success("Campaign started");
    router.push(`/agent/${data.run.id}`);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Brief</CardTitle>
            <CardDescription>The clearer the goal, the better the recommendations.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <Label htmlFor="topic">Topic</Label>
              <Input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="How small teams cut reporting time with automation"
                maxLength={500}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="goal">Goal</Label>
              <Input
                id="goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Book demos with operations leads"
                maxLength={500}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="audience">Audience (optional)</Label>
              <Input
                id="audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Operations managers at 20–200 person companies"
                maxLength={500}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="notes">Notes for the council (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Mention the new integration, avoid pricing claims."
                maxLength={2000}
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>One recommendation is produced per selected account (max {MAX_ACCOUNTS}).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No connected accounts. Connect one first on the connected accounts page.
              </p>
            )}
            {accounts.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm hover:bg-accent"
              >
                <Checkbox checked={selected.includes(a.id)} onCheckedChange={() => toggle(a.id)} />
                <PlatformIcon platform={a.platform} />
                <span className="min-w-0 flex-1 truncate">
                  {a.displayName}
                  {a.username && <span className="text-muted-foreground"> · @{a.username}</span>}
                </span>
                {a.agentAutoPublish && <span className="text-xs text-muted-foreground">auto-publish allowed</span>}
              </label>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Defaults come from your organization settings.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <Label>Assurance</Label>
              <Select value={assurance} onValueChange={(v) => setAssurance(v as AgentAssurance)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="JUDGE_ONLY">Judge only — faster and cheaper</SelectItem>
                  <SelectItem value="HIGH_ASSURANCE">High assurance — adds cross-review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Publishing</Label>
              <Select value={publishMode} onValueChange={(v) => setPublishMode(v as AgentPublishMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">Manual — recommendation only</SelectItem>
                  <SelectItem value="APPROVAL_REQUIRED">Approval required — a human decides</SelectItem>
                  {canAutomatic && <SelectItem value="AUTOMATIC">Automatic — publish without a human</SelectItem>}
                </SelectContent>
              </Select>
              {!canAutomatic && (
                <p className="text-xs text-muted-foreground">
                  Automatic publishing needs the organization mode set to automatic and publish permission.
                </p>
              )}
              {publishMode === "AUTOMATIC" && (
                <p className="text-xs text-amber-600">
                  Posts go out without review. Only accounts with auto-publish enabled are eligible.
                </p>
              )}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="schedule">Publish at (optional)</Label>
              <Input
                id="schedule"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Leave empty to publish as soon as it is approved.</p>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="maxCents">Budget for this campaign (cents)</Label>
              <Input
                id="maxCents"
                type="number"
                min={1}
                max={100000}
                value={maxCents}
                onChange={(e) => setMaxCents(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {maxCentsValid ? `About ${formatCents(parsedMaxCents)}.` : "Enter a whole number between 1 and 100000."}{" "}
                Capped at the organization limit of {formatCents(defaults.maxCents)}.
              </p>
            </div>
          </CardContent>
        </Card>
        <Button onClick={submit} disabled={!ready || busy}>
          {busy ? "Starting…" : "Start campaign"}
        </Button>
      </div>
    </div>
  );
}
