"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  accounts: { id: string; displayPhoneNumber: string }[];
  templates: { whatsappAccountId: string; name: string; language: string }[];
  tags: string[];
}

export function CampaignForm({ accounts, templates, tags }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [template, setTemplate] = useState("");
  const [name, setName] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [when, setWhen] = useState("");

  const available = templates.filter((t) => t.whatsappAccountId === accountId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const [templateName, templateLanguage] = template.split("::");
    setBusy(true);
    const res = await fetch("/api/whatsapp/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        whatsappAccountId: accountId,
        name,
        templateName,
        templateLanguage,
        audience: { tags: selectedTags, contactIds: [], excludeOptedOut: true },
        scheduledAt: when ? new Date(when).toISOString() : undefined,
      }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Failed");
    toast.success(`Campaign scheduled for ${data.campaign.totalRecipients} recipient(s)`);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={accounts.length === 0}>New campaign</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New template campaign</DialogTitle>
            <DialogDescription>
              Only approved templates can be broadcast. Leave the schedule empty to send immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div className="grid gap-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid gap-1">
              <Label>Number</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.displayPhoneNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Template</Label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder={available.length ? "Choose" : "No approved templates for this number"} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((t) => (
                    <SelectItem key={`${t.name}::${t.language}`} value={`${t.name}::${t.language}`}>
                      {t.name} ({t.language})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>Audience tags (none = everyone)</Label>
              <div className="flex flex-wrap gap-3">
                {tags.length === 0 && <span className="text-xs text-muted-foreground">No tags yet.</span>}
                {tags.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedTags.includes(t)}
                      onCheckedChange={(c) => setSelectedTags((s) => (c ? [...s, t] : s.filter((x) => x !== t)))}
                    />{" "}
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Schedule (optional)</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !template || !name}>
              {busy ? "Scheduling…" : "Schedule campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
