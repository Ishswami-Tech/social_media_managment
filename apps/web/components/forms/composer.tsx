"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Cpu, Hash, ImagePlus, Plug, Plus, Rocket, Search, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { countCharacters, plainTextToRichDoc, type RichNode } from "@platform/social-core";
import { uploadMediaFile } from "@/lib/client/upload";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { RichEditor, currentSelection, plainTextToHtml, type Editor } from "@/components/editor/rich-editor";
import { PostPreview } from "@/components/preview/post-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COMPOSER_SEED_KEY, ResearchPanel } from "@/components/forms/research-panel";
import { StatusBadge } from "@/components/app/status-badge";
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
export interface ComposerModel {
  provider: string;
  model: string;
  displayName: string;
  capabilities: string[];
}
export interface ComposerSkill {
  id: string;
  name: string;
  description: string;
}
interface Props {
  accounts: ComposerAccount[];
  media: ComposerMedia[];
  brands: { id: string; name: string; isDefault: boolean }[];
  canPublish: boolean;
  requireApproval: boolean;
  aiEnabled: boolean;
  /** Models the member may pick explicitly for AI actions (empty → automatic routing only). */
  models?: ComposerModel[];
  /** Research skills offered in the "+" menu. */
  skills?: ComposerSkill[];
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
const AUTO_MODEL = "__auto__";
const modelKey = (m: { provider: string; model: string }) => `${m.provider}::${m.model}`;
const modelParams = (sel: string) =>
  sel === AUTO_MODEL ? {} : { provider: sel.split("::")[0], model: sel.split("::")[1] };

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
  models = [],
  skills = [],
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
  const [researchOpen, setResearchOpen] = useState(false);
  const [researchSkill, setResearchSkill] = useState<string | undefined>(undefined);
  const [textModel, setTextModel] = useState(AUTO_MODEL);
  const [imageModel, setImageModel] = useState(AUTO_MODEL);
  const editorRef = useRef<Editor | null>(null);
  const textModels = models.filter((m) => m.capabilities.includes("text"));
  const imageModels = models.filter((m) => m.capabilities.includes("image"));
  const modelLabel = (sel: string) =>
    sel === AUTO_MODEL ? "automatic routing" : (models.find((m) => modelKey(m) === sel)?.displayName ?? sel);
  const [adaptWithAI, setAdaptWithAI] = useState(true);
  const [imageBusy, setImageBusy] = useState(false);
  const [publishResult, setPublishResult] = useState<{
    postId: string;
    variants: {
      platform: string;
      account: string;
      status: string;
      externalUrl: string | null;
      lastError: string | null;
    }[];
  } | null>(null);

  // Seed from the research panel (sessionStorage) when arriving via /create?seed=1
  useEffect(() => {
    if (existing) return;
    try {
      const raw = sessionStorage.getItem(COMPOSER_SEED_KEY);
      if (!raw) return;
      sessionStorage.removeItem(COMPOSER_SEED_KEY);
      const seed = JSON.parse(raw) as { text: string; title?: string };
      // One-time hand-off from the research panel; runs only on mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (seed.title) setTitle(seed.title);
      setMasterText(seed.text);
      setMasterReplace({ version: ++version.current, doc: plainTextToRichDoc(seed.text) });
    } catch {
      /* ignore */
    }
  }, [existing]);

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
    const data = await ai("/api/ai/generate", { idea: masterText, platforms, brandId, ...modelParams(textModel) });
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
    toast.success(`Platform variants generated (${modelLabel(textModel)})`);
  }

  /**
   * Rewrite / shorten / expand. When text is selected in the editor only the
   * selection is sent and replaced in place; otherwise the whole post is.
   */
  async function transform(op: "REWRITE" | "SHORTEN" | "EXPAND") {
    const selection = currentSelection(editorRef.current);
    const source = selection?.text ?? masterText;
    if (!source.trim()) return toast.error("Write something first");
    const data = await ai("/api/ai/transform", {
      text: source,
      operation: op,
      brandId,
      ...modelParams(textModel),
    });
    if (!data) return;
    const verb = { REWRITE: "rewritten", SHORTEN: "shortened", EXPAND: "expanded" }[op];
    if (selection && editorRef.current) {
      // Inline selections stay inline; multi-paragraph results become paragraphs.
      const html = data.text.includes("\n") ? plainTextToHtml(data.text) : plainTextToHtml(data.text).slice(3, -4);
      editorRef.current.chain().focus().insertContentAt({ from: selection.from, to: selection.to }, html).run();
      toast.success(`Selection ${verb} with ${modelLabel(textModel)}`);
      return;
    }
    setMasterText(data.text);
    setMasterReplace({ version: ++version.current, doc: plainTextToRichDoc(data.text) });
    toast.success(`Post ${verb} with ${modelLabel(textModel)}`);
  }

  function openSkill(skillId?: string) {
    setResearchSkill(skillId);
    setResearchOpen(true);
  }

  function insertResearch(text: string) {
    const next = masterText.trim() ? `${masterText.trimEnd()}\n\n${text}` : text;
    setMasterText(next);
    setMasterReplace({ version: ++version.current, doc: plainTextToRichDoc(next) });
    setResearchOpen(false);
    toast.success("Added to the post");
  }

  async function generateImage() {
    if (!masterText.trim()) return toast.error("Write the post first so the image matches it");
    setImageBusy(true);
    const data = await ai("/api/ai/image", {
      prompt: `Social media image for this post, no text overlay, photographic, brand-safe: ${masterText.slice(0, 600)}`,
      size: "1024x1024",
      ...modelParams(imageModel),
    });
    setImageBusy(false);
    if (!data) return;
    for (const a of data.assets as { id: string; fileName: string; url: string }[]) {
      setMedia((m) => [{ id: a.id, fileName: a.fileName, url: a.url, thumbnailUrl: a.url }, ...m]);
      setSharedMedia((sm) => [...sm, a.id]);
    }
    toast.success(`Image generated with ${data.model}`);
  }

  /**
   * One click: adapt the copy per platform with AI (optional), create the post
   * for every selected account and publish it immediately. Per-account
   * outcomes are shown when the worker reports back.
   */
  async function publishEverywhere() {
    if (!masterText.trim()) return toast.error("Post text is required");
    if (selectedAccounts.length === 0) return toast.error("Select at least one account");
    setBusy(true);
    const variantText: Record<string, string> = {};
    if (adaptWithAI && aiEnabled) {
      const platforms = [...new Set(selectedAccounts.filter((a) => !variants[a.id]?.custom).map((a) => a.platform))];
      if (platforms.length) {
        const data = await ai("/api/ai/generate", { idea: masterText, platforms, brandId, ...modelParams(textModel) });
        if (data) {
          for (const a of selectedAccounts) {
            const gen = data.variants.find((x: { platform: string }) => x.platform === a.platform);
            if (gen && !variants[a.id]?.custom)
              variantText[a.id] =
                `${gen.text}${gen.hashtags?.length && !gen.text.includes("#") ? `\n\n${gen.hashtags.join(" ")}` : ""}`;
          }
        }
      }
    }
    for (const a of selectedAccounts) {
      if (a.mediaRequired && mediaFor(a.id).length === 0) {
        setBusy(false);
        return toast.error(`${a.displayName} needs an image. Add one or click "Generate image".`);
      }
    }
    const payload = {
      title: title || undefined,
      masterText,
      variants: selectedAccounts.map((a) => ({
        socialAccountId: a.id,
        text: variantText[a.id] ?? textFor(a.id),
        mediaAssetIds: mediaFor(a.id),
      })),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      autoPublishOnApproval: false,
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
    const pub = await fetch(`/api/posts/${id}/publish`, { method: "POST" });
    const pd = await pub.json();
    if (!pub.ok) {
      setBusy(false);
      toast.error(pd.message ?? "Publish failed");
      router.push(`/posts/${id}`);
      return;
    }
    const snapshot = (p: {
      variants: {
        platform: string;
        status: string;
        externalUrl: string | null;
        lastError: string | null;
        socialAccount: { displayName: string };
      }[];
    }) =>
      p.variants.map((v) => ({
        platform: v.platform,
        account: v.socialAccount.displayName,
        status: v.status,
        externalUrl: v.externalUrl,
        lastError: v.lastError,
      }));
    setPublishResult({ postId: id, variants: snapshot(pd.post) });
    setBusy(false);
    // Poll for a few seconds so the dialog reflects the worker's outcome per platform.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await fetch(`/api/posts/${id}`);
      if (!r.ok) break;
      const { post } = await r.json();
      setPublishResult({ postId: id, variants: snapshot(post) });
      if (
        post.variants.every((v: { status: string }) =>
          ["PUBLISHED", "FAILED", "DISCONNECTED_ACCOUNT"].includes(v.status),
        )
      )
        break;
    }
  }

  async function suggestHashtags() {
    if (!masterText.trim()) return;
    const data = await ai("/api/ai/hashtags", {
      text: masterText,
      platform: previewAccount?.platform ?? "LINKEDIN",
      count: 6,
      ...modelParams(textModel),
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
          {aiEnabled && !accountId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={generateImage}
              disabled={imageBusy || !masterText.trim()}
            >
              <Sparkles /> {imageBusy ? "Generating…" : "Generate image"}
            </Button>
          )}
          {aiEnabled && !accountId && imageModels.length > 0 && (
            <Select value={imageModel} onValueChange={setImageModel}>
              <SelectTrigger size="sm" className="h-8 max-w-44 text-xs" aria-label="Image model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_MODEL}>Auto image model</SelectItem>
                {imageModels.map((m) => (
                  <SelectItem key={modelKey(m)} value={modelKey(m)}>
                    {m.displayName} · {m.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
              editorRef={editorRef}
              extraToolbar={
                aiEnabled ? (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-7 rounded-full"
                          title="Add skills, plugins and connectors"
                          aria-label="Add skills, plugins and connectors"
                        >
                          <Plus />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72">
                        <DropdownMenuLabel className="text-xs text-muted-foreground">Skills</DropdownMenuLabel>
                        {skills.map((sk) => (
                          <DropdownMenuItem key={sk.id} onSelect={() => openSkill(sk.id)}>
                            <Search />
                            <span className="grid">
                              <span>{sk.name}</span>
                              <span className="text-xs text-muted-foreground">{sk.description}</span>
                            </span>
                          </DropdownMenuItem>
                        ))}
                        {skills.length === 0 && (
                          <DropdownMenuItem onSelect={() => openSkill()}>
                            <Search /> Research with AI
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs text-muted-foreground">Plugins</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => generateImage()} disabled={imageBusy || !masterText.trim()}>
                          <Sparkles /> Generate image from this post
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => suggestHashtags()} disabled={aiBusy || !masterText.trim()}>
                          <Hash /> Suggest hashtags
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                          <ImagePlus /> Upload image
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs text-muted-foreground">Connectors</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => router.push("/settings#connectors")}>
                          <Plug /> Web search, feeds and AI keys…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {textModels.length > 0 && (
                      <Select value={textModel} onValueChange={setTextModel}>
                        <SelectTrigger
                          size="sm"
                          className="h-7 max-w-44 text-xs"
                          title="Model used for rewrite, variants and hashtags"
                          aria-label="AI model"
                        >
                          <Cpu className="size-3.5" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUTO_MODEL}>Auto (cheapest capable)</SelectItem>
                          {textModels.map((m) => (
                            <SelectItem key={modelKey(m)} value={modelKey(m)}>
                              {m.displayName} · {m.provider}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
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
                      title="Rewrite with AI (select text to rewrite only that part)"
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
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => openSkill()}
                      title="Research with AI (web search, URLs, feeds)"
                    >
                      <Search /> Research
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
                {aiEnabled && (
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox checked={adaptWithAI} onCheckedChange={(c) => setAdaptWithAI(!!c)} /> Adapt copy per
                    platform with AI before publishing
                  </label>
                )}
                <Button onClick={publishEverywhere} disabled={busy || selectedAccounts.length === 0}>
                  <Rocket />{" "}
                  {busy
                    ? "Publishing…"
                    : `Publish to ${selectedAccounts.length || "all"} platform${selectedAccounts.length === 1 ? "" : "s"} now`}
                </Button>
                <Button variant="outline" onClick={() => save("schedule")} disabled={busy || !schedule}>
                  Schedule instead
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

      <Dialog open={researchOpen} onOpenChange={setResearchOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Research with AI</DialogTitle>
            <DialogDescription>
              Search the web, read a URL or a feed, and drop the findings straight into your post.
            </DialogDescription>
          </DialogHeader>
          <ResearchPanel key={researchSkill ?? "default"} compact initialSkill={researchSkill} onUse={insertResearch} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!publishResult}
        onOpenChange={(o) => !o && publishResult && router.push(`/posts/${publishResult.postId}`)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publishing to {publishResult?.variants.length} platform(s)</DialogTitle>
            <DialogDescription>
              Each platform publishes independently; failures never block the others.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {publishResult?.variants.map((v) => (
              <div
                key={`${v.platform}-${v.account}`}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <PlatformIcon platform={v.platform} /> {v.account}
                </span>
                <span className="flex items-center gap-2">
                  {v.externalUrl && (
                    <a href={v.externalUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                      View
                    </a>
                  )}
                  <StatusBadge status={v.status} />
                </span>
              </div>
            ))}
            {publishResult?.variants.some((v) => v.lastError) && (
              <p className="text-xs text-destructive">{publishResult.variants.find((v) => v.lastError)?.lastError}</p>
            )}
          </div>
          <Button onClick={() => publishResult && router.push(`/posts/${publishResult.postId}`)}>Open post</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
