"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, ImagePlus, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { countCharacters, plainTextToRichDoc, type RichNode } from "@platform/social-core";
import { uploadMediaFile } from "@/lib/client/upload";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { RichEditor } from "@/components/editor/rich-editor";
import { PostPreview } from "@/components/preview/post-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface ComposerAccount {
  id: string;
  platform: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  maxLength: number;
  mediaRequired: boolean;
}
export interface ComposerMedia {
  id: string;
  fileName: string;
  url: string;
  thumbnailUrl: string;
}
interface Props {
  accounts: ComposerAccount[];
  media: ComposerMedia[];
  brands: { id: string; name: string; isDefault: boolean }[];
  canPublish: boolean;
  requireApproval: boolean;
  aiEnabled: boolean;
  existing: {
    id: string;
    title: string;
    masterText: string;
    scheduledAt: string | null;
    autoPublishOnApproval: boolean;
    variants: { socialAccountId: string; text: string; mediaAssetIds: string[] }[];
  } | null;
}

type VariantState = {
  text: string;
  doc: RichNode;
  mediaAssetIds: string[];
  custom: boolean;
  replace: { version: number; doc: RichNode } | null;
};
type AfterApproval = "immediately" | "scheduled" | "hold";

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Composer({
  accounts,
  media: initialMedia,
  brands,
  canPublish,
  requireApproval,
  aiEnabled,
  existing,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [masterText, setMasterText] = useState(existing?.masterText ?? "");
  const [masterReplace, setMasterReplace] = useState<{ version: number; doc: RichNode } | null>(null);
  const [selected, setSelected] = useState<string[]>(existing?.variants.map((v) => v.socialAccountId) ?? []);
  const [variants, setVariants] = useState<Record<string, VariantState>>(
    Object.fromEntries(
      (existing?.variants ?? []).map((v) => [
        v.socialAccountId,
        {
          text: v.text,
          doc: plainTextToRichDoc(v.text),
          mediaAssetIds: v.mediaAssetIds,
          custom: v.text !== existing?.masterText,
          replace: null,
        },
      ]),
    ),
  );
  const [media, setMedia] = useState<ComposerMedia[]>(initialMedia);
  const [sharedMedia, setSharedMedia] = useState<string[]>(existing?.variants[0]?.mediaAssetIds ?? []);
  const [brandId, setBrandId] = useState<string | undefined>(brands.find((b) => b.isDefault)?.id ?? brands[0]?.id);
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [schedule, setSchedule] = useState(toLocal(existing?.scheduledAt ?? null));
  const [afterApproval, setAfterApproval] = useState<AfterApproval>(
    existing?.autoPublishOnApproval ? (existing.scheduledAt ? "scheduled" : "immediately") : "hold",
  );
  const [previewAccountId, setPreviewAccountId] = useState<string | null>(null);
  const [collapsedPreview, setCollapsedPreview] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const version = useRef(1);

  const selectedAccounts = useMemo(() => accounts.filter((a) => selected.includes(a.id)), [accounts, selected]);
  const previewAccount = selectedAccounts.find((a) => a.id === previewAccountId) ?? selectedAccounts[0] ?? accounts[0];

  const variantFor = useCallback(
    (id: string): VariantState =>
      variants[id] ?? {
        text: masterText,
        doc: plainTextToRichDoc(masterText),
        mediaAssetIds: sharedMedia,
        custom: false,
        replace: null,
      },
    [variants, masterText, sharedMedia],
  );
  const textFor = (id: string) => {
    const v = variantFor(id);
    return v.custom ? v.text : masterText;
  };
  const mediaFor = (id: string) => (variants[id]?.custom ? variants[id]!.mediaAssetIds : sharedMedia);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const onMasterChange = useCallback((text: string) => setMasterText(text), []);
  const onVariantChange = useCallback(
    (id: string, text: string, doc: RichNode) =>
      setVariants((v) => ({
        ...v,
        [id]: { ...(v[id] ?? { mediaAssetIds: [], replace: null }), text, doc, custom: true },
      })),
    [],
  );

  function toggleMedia(mediaId: string, accountId?: string) {
    if (accountId && variants[accountId]?.custom) {
      setVariants((v) => {
        const cur = v[accountId]!;
        const has = cur.mediaAssetIds.includes(mediaId);
        return {
          ...v,
          [accountId]: {
            ...cur,
            mediaAssetIds: has ? cur.mediaAssetIds.filter((m) => m !== mediaId) : [...cur.mediaAssetIds, mediaId],
          },
        };
      });
    } else {
      setSharedMedia((s) => (s.includes(mediaId) ? s.filter((m) => m !== mediaId) : [...s, mediaId]));
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        setUploadPct(0);
        const asset = await uploadMediaFile(file, setUploadPct);
        setMedia((m) => [
          { id: asset.id, fileName: asset.fileName, url: asset.url, thumbnailUrl: asset.thumbnailUrl },
          ...m,
        ]);
        setSharedMedia((s) => [...s, asset.id]);
        toast.success(`${file.name} added`);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploadPct(null);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function ai(url: string, body: unknown) {
    setAiBusy(true);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setAiBusy(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? "AI request failed");
      return null;
    }
    return data;
  }

  async function generateVariants() {
    if (!masterText.trim()) return toast.error("Write an idea or draft first");
    if (selectedAccounts.length === 0) return toast.error("Select at least one account");
    const platforms = [...new Set(selectedAccounts.map((a) => a.platform))];
    const data = await ai("/api/ai/generate", { idea: masterText, platforms, brandId });
    if (!data) return;
    setVariants((v) => {
      const next = { ...v };
      for (const a of selectedAccounts) {
        const gen = data.variants.find((x: { platform: string }) => x.platform === a.platform);
        if (!gen) continue;
        const tags = gen.hashtags?.length && !gen.text.includes("#") ? `\n\n${gen.hashtags.join(" ")}` : "";
        const text = `${gen.text}${tags}`;
        const doc = plainTextToRichDoc(text);
        next[a.id] = {
          text,
          doc,
          mediaAssetIds: v[a.id]?.mediaAssetIds ?? sharedMedia,
          custom: true,
          replace: { version: ++version.current, doc },
        };
      }
      return next;
    });
    toast.success("Platform variants generated");
  }

  async function transform(op: "REWRITE" | "SHORTEN" | "EXPAND") {
    if (!masterText.trim()) return;
    const data = await ai("/api/ai/transform", { text: masterText, operation: op, brandId });
    if (!data) return;
    setMasterText(data.text);
    setMasterReplace({ version: ++version.current, doc: plainTextToRichDoc(data.text) });
  }

  async function suggestHashtags() {
    if (!masterText.trim()) return;
    const data = await ai("/api/ai/hashtags", {
      text: masterText,
      platform: previewAccount?.platform ?? "LINKEDIN",
      count: 6,
    });
    if (!data) return;
    const existingTags = new Set(masterText.match(/#[\p{L}\p{N}_]+/gu) ?? []);
    const add = (data.hashtags as string[]).filter((h) => !existingTags.has(h));
    if (add.length === 0) return toast.info("No new hashtags to add");
    const text = `${masterText.trimEnd()}\n\n${add.join(" ")}`;
    setMasterText(text);
    setMasterReplace({ version: ++version.current, doc: plainTextToRichDoc(text) });
  }

  async function save(action: "draft" | "submit" | "schedule" | "publish") {
    if (!masterText.trim()) return toast.error("Post text is required");
    if (selectedAccounts.length === 0) return toast.error("Select at least one account");
    for (const a of selectedAccounts) {
      if (a.mediaRequired && mediaFor(a.id).length === 0)
        return toast.error(`${a.displayName} requires at least one image`);
      if (countCharacters(textFor(a.id)) > a.maxLength)
        return toast.error(`${a.displayName}: text exceeds ${a.maxLength} characters`);
    }
    if ((action === "schedule" || afterApproval === "scheduled") && !schedule)
      return toast.error("Choose a date and time");
    setBusy(true);
    const scheduledAt = schedule ? new Date(schedule).toISOString() : undefined;
    const payload = {
      title: title || undefined,
      masterText,
      variants: selectedAccounts.map((a) => ({
        socialAccountId: a.id,
        text: textFor(a.id),
        mediaAssetIds: mediaFor(a.id),
      })),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      scheduledAt: afterApproval === "scheduled" || action === "schedule" ? scheduledAt : undefined,
      autoPublishOnApproval: action === "submit" && afterApproval !== "hold",
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
      const body = action === "schedule" ? { scheduledAt, timezone: payload.timezone } : undefined;
      const r2 = await fetch(`/api/posts/${id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d2 = await r2.json();
      if (!r2.ok) {
        setBusy(false);
        toast.error(d2.message ?? "Saved, but the next step failed");
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

  const previewMedia = previewAccount
    ? mediaFor(previewAccount.id)
        .map((id) => media.find((m) => m.id === id))
        .filter(Boolean)
        .map((m) => ({ id: m!.id, url: m!.url, alt: m!.fileName }))
    : [];

  // Plain render helper (not a component) so React does not remount the picker on every render.
  const renderMediaPicker = (accountId?: string) => {
    const chosen = accountId ? mediaFor(accountId) : sharedMedia;
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={uploadPct !== null}
          >
            <ImagePlus /> Add image
          </Button>
          {uploadPct !== null && <Progress value={uploadPct} className="w-32" />}
          <span className="text-xs text-muted-foreground">{chosen.length} selected</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {media.map((m) => {
            const idx = chosen.indexOf(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMedia(m.id, accountId)}
                className={cn("relative size-16 overflow-hidden rounded-md border", idx >= 0 && "ring-2 ring-primary")}
                title={m.fileName}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumbnailUrl} alt={m.fileName} className="size-full object-cover" />
                {idx >= 0 && (
                  <span className="absolute top-0.5 right-0.5 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                    {idx + 1}
                  </span>
                )}
              </button>
            );
          })}
          {media.length === 0 && (
            <p className="text-xs text-muted-foreground">No images yet. Upload one to see it in the preview.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Write</CardTitle>
            <CardDescription>
              Bold, italic and lists are converted to LinkedIn-style formatting when published. Hashtags are highlighted
              in the preview.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input placeholder="Internal title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <RichEditor
              initialDoc={existing ? plainTextToRichDoc(existing.masterText) : undefined}
              placeholder="What do you want to share? Paste an idea, a blog excerpt or write the post…"
              onChange={onMasterChange}
              replaceWith={masterReplace}
              extraToolbar={
                aiEnabled ? (
                  <>
                    {brands.length > 0 && (
                      <Select value={brandId} onValueChange={setBrandId}>
                        <SelectTrigger size="sm" className="h-7 text-xs">
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
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => transform("REWRITE")}
                      disabled={aiBusy}
                      title="Rewrite with AI"
                    >
                      <Wand2 /> Rewrite
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => transform("SHORTEN")}
                      disabled={aiBusy}
                    >
                      Shorten
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => transform("EXPAND")}
                      disabled={aiBusy}
                    >
                      Expand
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={suggestHashtags}
                      disabled={aiBusy}
                      title="Suggest hashtags"
                    >
                      <Hash /> Hashtags
                    </Button>
                  </>
                ) : null
              }
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{countCharacters(masterText)} characters</span>
              {aiEnabled && (
                <Button
                  type="button"
                  size="sm"
                  onClick={generateVariants}
                  disabled={aiBusy || selectedAccounts.length === 0}
                >
                  <Sparkles /> {aiBusy ? "Working…" : "Generate per-platform variants"}
                </Button>
              )}
            </div>
            {renderMediaPicker()}
          </CardContent>
        </Card>

        {selectedAccounts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Per-platform variants</CardTitle>
              <CardDescription>Each account uses the master text until you customise it here.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue={selectedAccounts[0]!.id} onValueChange={setPreviewAccountId}>
                <TabsList className="flex-wrap">
                  {selectedAccounts.map((a) => (
                    <TabsTrigger key={a.id} value={a.id} className="gap-1">
                      <PlatformIcon platform={a.platform} className="size-4 text-[8px]" /> {a.displayName}
                      {variants[a.id]?.custom && (
                        <Badge variant="outline" className="ml-1 px-1 text-[10px]">
                          custom
                        </Badge>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {selectedAccounts.map((a) => {
                  const v = variantFor(a.id);
                  const text = textFor(a.id);
                  const count = countCharacters(text);
                  return (
                    <TabsContent key={a.id} value={a.id} className="grid gap-3 pt-2">
                      {v.custom ? (
                        <RichEditor
                          initialDoc={v.doc}
                          onChange={(t, d) => onVariantChange(a.id, t, d)}
                          replaceWith={v.replace}
                          minRows={4}
                        />
                      ) : (
                        <div className="rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
                          Using master text.{" "}
                          <button
                            type="button"
                            className="text-foreground underline"
                            onClick={() =>
                              setVariants((s) => ({
                                ...s,
                                [a.id]: {
                                  ...v,
                                  custom: true,
                                  text: masterText,
                                  doc: plainTextToRichDoc(masterText),
                                  mediaAssetIds: sharedMedia,
                                  replace: null,
                                },
                              }))
                            }
                          >
                            Customise for {a.platform.toLowerCase()}
                          </button>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className={cn("text-muted-foreground", count > a.maxLength && "font-medium text-destructive")}
                        >
                          {count} / {a.maxLength}
                        </span>
                        {v.custom && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setVariants((s) => {
                                const n = { ...s };
                                delete n[a.id];
                                return n;
                              })
                            }
                          >
                            <X /> Reset to master
                          </Button>
                        )}
                      </div>
                      {v.custom && (
                        <div>
                          <p className="mb-2 text-xs font-medium">
                            Media for this platform {a.mediaRequired && <Badge variant="warning">required</Badge>}
                          </p>
                          {renderMediaPicker(a.id)}
                        </div>
                      )}
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
            <CardTitle className="flex items-center justify-between">
              Preview
              {previewAccount && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setCollapsedPreview((c) => !c)}>
                  {collapsedPreview ? "Full text" : "Feed view"}
                </Button>
              )}
            </CardTitle>
            <CardDescription>
              {previewAccount
                ? `How it will appear on ${previewAccount.platform.toLowerCase()}`
                : "Select an account to preview"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {previewAccount ? (
              <PostPreview
                platform={previewAccount.platform}
                account={{
                  displayName: previewAccount.displayName,
                  username: previewAccount.username,
                  avatarUrl: previewAccount.avatarUrl,
                }}
                text={textFor(previewAccount.id) || "Your post will appear here…"}
                media={previewMedia}
                collapsed={collapsedPreview}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Connect and select an account.</p>
            )}
          </CardContent>
        </Card>

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
              {requireApproval ? "This organization reviews posts before they go out." : "No approval required."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {requireApproval && (
              <div className="grid gap-1">
                <Label className="text-xs">After approval</Label>
                <Select value={afterApproval} onValueChange={(v) => setAfterApproval(v as AfterApproval)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="immediately">Publish immediately</SelectItem>
                    <SelectItem value="scheduled">Publish at the scheduled time</SelectItem>
                    <SelectItem value="hold">Hold until someone schedules it</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {(afterApproval === "scheduled" || canPublish) && (
              <div className="grid gap-1">
                <Label htmlFor="schedule" className="text-xs">
                  Date and time
                </Label>
                <Input
                  id="schedule"
                  type="datetime-local"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                />
              </div>
            )}
            <Button variant="outline" onClick={() => save("draft")} disabled={busy}>
              Save draft
            </Button>
            {requireApproval && (
              <Button onClick={() => save("submit")} disabled={busy}>
                Submit for approval
              </Button>
            )}
            {canPublish && !requireApproval && (
              <>
                <Button onClick={() => save("schedule")} disabled={busy || !schedule}>
                  Schedule
                </Button>
                <Button variant="secondary" onClick={() => save("publish")} disabled={busy}>
                  Publish now
                </Button>
              </>
            )}
            {requireApproval && afterApproval !== "hold" && (
              <p className="text-xs text-muted-foreground">
                Once an approver accepts it, the post{" "}
                {afterApproval === "immediately" ? "is published straight away" : "is queued for the chosen time"}. No
                further action needed.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
