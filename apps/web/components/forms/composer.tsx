"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Account {
  id: string;
  platform: string;
  displayName: string;
  maxLength: number;
  mediaRequired: boolean;
}
interface Props {
  accounts: Account[];
  media: { id: string; fileName: string; url: string }[];
  brands: { id: string; name: string; isDefault: boolean }[];
  canPublish: boolean;
  requireApproval: boolean;
  aiEnabled: boolean;
  existing: {
    id: string;
    title: string;
    masterText: string;
    variants: { socialAccountId: string; text: string; mediaAssetIds: string[] }[];
  } | null;
}

type VariantState = { text: string; mediaAssetIds: string[]; custom: boolean };

export function Composer({ accounts, media, brands, canPublish, requireApproval, aiEnabled, existing }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [masterText, setMasterText] = useState(existing?.masterText ?? "");
  const [selected, setSelected] = useState<string[]>(existing?.variants.map((v) => v.socialAccountId) ?? []);
  const [variants, setVariants] = useState<Record<string, VariantState>>(
    Object.fromEntries(
      (existing?.variants ?? []).map((v) => [
        v.socialAccountId,
        { text: v.text, mediaAssetIds: v.mediaAssetIds, custom: v.text !== existing?.masterText },
      ]),
    ),
  );
  const [brandId, setBrandId] = useState<string | undefined>(brands.find((b) => b.isDefault)?.id ?? brands[0]?.id);
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [schedule, setSchedule] = useState("");

  const selectedAccounts = useMemo(() => accounts.filter((a) => selected.includes(a.id)), [accounts, selected]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setVariants((v) => (v[id] ? v : { ...v, [id]: { text: masterText, mediaAssetIds: [], custom: false } }));
  }

  function variantFor(id: string): VariantState {
    return variants[id] ?? { text: masterText, mediaAssetIds: [], custom: false };
  }

  function setVariantText(id: string, text: string) {
    setVariants((v) => ({ ...v, [id]: { ...variantFor(id), text, custom: true } }));
  }

  function toggleMedia(id: string, mediaId: string) {
    setVariants((v) => {
      const cur = variantFor(id);
      const has = cur.mediaAssetIds.includes(mediaId);
      return {
        ...v,
        [id]: {
          ...cur,
          mediaAssetIds: has ? cur.mediaAssetIds.filter((m) => m !== mediaId) : [...cur.mediaAssetIds, mediaId],
        },
      };
    });
  }

  async function generateVariants() {
    if (!masterText.trim()) return toast.error("Write an idea or draft first");
    if (selectedAccounts.length === 0) return toast.error("Select at least one account");
    setAiBusy(true);
    const platforms = [...new Set(selectedAccounts.map((a) => a.platform))];
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: masterText, platforms, brandId }),
    });
    setAiBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "AI generation failed");
    setVariants((v) => {
      const next = { ...v };
      for (const a of selectedAccounts) {
        const gen = data.variants.find((x: { platform: string }) => x.platform === a.platform);
        if (gen) {
          const tags = gen.hashtags?.length && !gen.text.includes("#") ? `\n\n${gen.hashtags.join(" ")}` : "";
          next[a.id] = { ...variantFor(a.id), text: `${gen.text}${tags}`, custom: true };
        }
      }
      return next;
    });
    toast.success("Platform variants generated");
  }

  async function transform(op: "REWRITE" | "SHORTEN" | "EXPAND") {
    if (!masterText.trim()) return;
    setAiBusy(true);
    const res = await fetch("/api/ai/transform", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: masterText, operation: op, brandId }),
    });
    setAiBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "AI failed");
    setMasterText(data.text);
  }

  async function save(action: "draft" | "submit" | "schedule" | "publish") {
    if (!masterText.trim()) return toast.error("Post text is required");
    if (selectedAccounts.length === 0) return toast.error("Select at least one account");
    for (const a of selectedAccounts) {
      const v = variantFor(a.id);
      if (a.mediaRequired && v.mediaAssetIds.length === 0)
        return toast.error(`${a.displayName} requires at least one image`);
      if ((v.custom ? v.text : masterText).length > a.maxLength)
        return toast.error(`${a.displayName}: text exceeds ${a.maxLength} characters`);
    }
    setBusy(true);
    const payload = {
      title: title || undefined,
      masterText,
      variants: selectedAccounts.map((a) => {
        const v = variantFor(a.id);
        return { socialAccountId: a.id, text: v.custom ? v.text : masterText, mediaAssetIds: v.mediaAssetIds };
      }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const res = await fetch(existing ? `/api/posts/${existing.id}` : "/api/posts", {
      method: existing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setBusy(false);
      return toast.error(data.message ?? "Save failed");
    }
    const id = data.post.id as string;
    if (action !== "draft") {
      const path = action === "submit" ? "submit" : action === "publish" ? "publish" : "schedule";
      const body =
        action === "schedule"
          ? { scheduledAt: new Date(schedule).toISOString(), timezone: payload.timezone }
          : undefined;
      const r2 = await fetch(`/api/posts/${id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d2 = await r2.json();
      if (!r2.ok) {
        setBusy(false);
        toast.error(d2.message ?? "Saved as draft, but the next step failed");
        router.push(`/posts/${id}`);
        return;
      }
    }
    setBusy(false);
    toast.success(
      action === "draft"
        ? "Draft saved"
        : action === "submit"
          ? "Submitted for approval"
          : action === "publish"
            ? "Publishing…"
            : "Scheduled",
    );
    router.push(`/posts/${id}`);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
            <CardDescription>
              The master text is used for every platform unless you customise a variant.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input placeholder="Internal title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea
              rows={8}
              placeholder="What do you want to say? Paste an idea, a blog excerpt or a full draft…"
              value={masterText}
              onChange={(e) => setMasterText(e.target.value)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{masterText.length} characters</span>
              {aiEnabled && (
                <span className="flex items-center gap-2">
                  {brands.length > 0 && (
                    <Select value={brandId} onValueChange={setBrandId}>
                      <SelectTrigger size="sm" className="h-7">
                        <SelectValue placeholder="Brand" />
                      </SelectTrigger>
                      <SelectContent>
                        {brands.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => transform("REWRITE")} disabled={aiBusy}>
                    <Wand2 /> Rewrite
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => transform("SHORTEN")} disabled={aiBusy}>
                    Shorten
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => transform("EXPAND")} disabled={aiBusy}>
                    Expand
                  </Button>
                </span>
              )}
            </div>
          </CardContent>
        </Card>
        {selectedAccounts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Platform variants
                {aiEnabled && (
                  <Button size="sm" onClick={generateVariants} disabled={aiBusy}>
                    <Sparkles /> {aiBusy ? "Generating…" : "Generate with AI"}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue={selectedAccounts[0]!.id}>
                <TabsList className="flex-wrap">
                  {selectedAccounts.map((a) => (
                    <TabsTrigger key={a.id} value={a.id} className="gap-1">
                      <PlatformIcon platform={a.platform} className="size-4 text-[8px]" /> {a.displayName}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {selectedAccounts.map((a) => {
                  const v = variantFor(a.id);
                  const text = v.custom ? v.text : masterText;
                  const over = text.length > a.maxLength;
                  return (
                    <TabsContent key={a.id} value={a.id} className="grid gap-3 pt-2">
                      <Textarea rows={6} value={text} onChange={(e) => setVariantText(a.id, e.target.value)} />
                      <div className="flex items-center justify-between text-xs">
                        <span className={cn("text-muted-foreground", over && "font-medium text-destructive")}>
                          {text.length} / {a.maxLength}
                        </span>
                        {v.custom && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setVariants((s) => ({ ...s, [a.id]: { ...v, custom: false, text: masterText } }))
                            }
                          >
                            Reset to master
                          </Button>
                        )}
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-medium">
                          Media {a.mediaRequired && <Badge variant="warning">required</Badge>}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {media.length === 0 && (
                            <p className="text-xs text-muted-foreground">No ready images in the library yet.</p>
                          )}
                          {media.map((m) => {
                            const on = v.mediaAssetIds.includes(m.id);
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => toggleMedia(a.id, m.id)}
                                className={cn(
                                  "relative size-16 overflow-hidden rounded-md border",
                                  on && "ring-2 ring-primary",
                                )}
                                title={m.fileName}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={m.url} alt={m.fileName} className="size-full object-cover" />
                                {on && (
                                  <span className="absolute top-0.5 right-0.5 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                                    {v.mediaAssetIds.indexOf(m.id) + 1}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {accounts.length === 0 && <p className="text-sm text-muted-foreground">Connect an account first.</p>}
            {accounts.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-2 text-sm hover:bg-accent"
              >
                <Checkbox checked={selected.includes(a.id)} onCheckedChange={() => toggle(a.id)} />
                <PlatformIcon platform={a.platform} />
                <span className="truncate">{a.displayName}</span>
              </label>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Publish</CardTitle>
            <CardDescription>
              {requireApproval ? "Approval is required for this organization." : "No approval required."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button variant="outline" onClick={() => save("draft")} disabled={busy}>
              Save draft
            </Button>
            {requireApproval && (
              <Button onClick={() => save("submit")} disabled={busy}>
                Submit for approval
              </Button>
            )}
            {canPublish && (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="schedule" className="text-xs">
                    Schedule
                  </Label>
                  <Input
                    id="schedule"
                    type="datetime-local"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                  />
                </div>
                <Button onClick={() => save("schedule")} disabled={busy || !schedule || requireApproval}>
                  Schedule
                </Button>
                <Button variant="secondary" onClick={() => save("publish")} disabled={busy || requireApproval}>
                  Publish now
                </Button>
                {requireApproval && (
                  <p className="text-xs text-muted-foreground">
                    Scheduling becomes available once the post is approved.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
