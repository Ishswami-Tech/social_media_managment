"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PLATFORMS } from "@platform/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ResearchPanel } from "@/components/forms/research-panel";

interface Model {
  provider: string;
  model: string;
  displayName: string;
  capabilities: string[];
}
interface Props {
  models: Model[];
  brands: { id: string; name: string; isDefault: boolean }[];
  canImage: boolean;
}

const AUTO = "__auto__";

export function AIStudio({ models, brands, canImage }: Props) {
  const [brandId, setBrandId] = useState<string | undefined>(brands.find((b) => b.isDefault)?.id ?? brands[0]?.id);
  const [textModel, setTextModel] = useState(AUTO);
  const [imageModel, setImageModel] = useState(AUTO);
  const [busy, setBusy] = useState(false);

  // generate
  const [idea, setIdea] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["LINKEDIN", "INSTAGRAM"]);
  const [variants, setVariants] = useState<
    { platform: string; text: string; hashtags: string[]; hook?: string; cta?: string }[]
  >([]);
  // image
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<{ id: string; url: string }[]>([]);
  // hooks
  const [hookText, setHookText] = useState("");
  const [hooks, setHooks] = useState<{ hashtags: string[]; hooks: string[]; ctas: string[] } | null>(null);
  // calendar
  const [theme, setTheme] = useState("");
  const [calendar, setCalendar] = useState<
    { date: string; platform: string; title: string; idea: string; format?: string }[]
  >([]);

  const modelParams = (sel: string) =>
    sel === AUTO ? {} : { provider: sel.split("::")[0], model: sel.split("::")[1] };

  async function post(url: string, body: unknown) {
    setBusy(true);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? "AI request failed");
      return null;
    }
    return data;
  }

  const textModels = models.filter((m) => m.capabilities.includes("text"));
  const imageModels = models.filter((m) => m.capabilities.includes("image"));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {brands.length > 0 && (
          <div className="grid gap-1">
            <Label className="text-xs">Brand</Label>
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1">
          <Label className="text-xs">Text model</Label>
          <Select value={textModel} onValueChange={setTextModel}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Automatic routing</SelectItem>
              {textModels.map((m) => (
                <SelectItem key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                  {m.displayName} · {m.provider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canImage && (
          <div className="grid gap-1">
            <Label className="text-xs">Image model</Label>
            <Select value={imageModel} onValueChange={setImageModel}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Automatic routing</SelectItem>
                {imageModels.map((m) => (
                  <SelectItem key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                    {m.displayName} · {m.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <Tabs defaultValue="research">
        <TabsList>
          <TabsTrigger value="research">Research</TabsTrigger>
          <TabsTrigger value="generate">Copy</TabsTrigger>
          {canImage && <TabsTrigger value="image">Images</TabsTrigger>}
          <TabsTrigger value="hooks">Hooks & hashtags</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>
        <TabsContent value="research">
          <ResearchPanel />
        </TabsContent>
        <TabsContent value="generate">
          <Card>
            <CardHeader>
              <CardTitle>Generate platform variants</CardTitle>
              <CardDescription>One idea in, a tailored post per platform out.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Textarea
                rows={5}
                placeholder="Idea, announcement, blog excerpt…"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
              />
              <div className="flex flex-wrap gap-3">
                {PLATFORMS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={platforms.includes(p)}
                      onCheckedChange={(c) => setPlatforms((s) => (c ? [...s, p] : s.filter((x) => x !== p)))}
                    />
                    {p}
                  </label>
                ))}
              </div>
              <Button
                className="w-fit"
                disabled={busy || !idea || platforms.length === 0}
                onClick={async () => {
                  const d = await post("/api/ai/generate", { idea, platforms, brandId, ...modelParams(textModel) });
                  if (d) setVariants(d.variants);
                }}
              >
                {busy ? "Generating…" : "Generate"}
              </Button>
              <div className="grid gap-3 md:grid-cols-2">
                {variants.map((v, i) => (
                  <Card key={i} className="gap-2 py-4">
                    <CardHeader>
                      <CardTitle className="text-sm">{v.platform}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2">
                      <p className="text-sm whitespace-pre-wrap">{v.text}</p>
                      <p className="text-xs text-muted-foreground">{v.hashtags.join(" ")}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(`${v.text}\n\n${v.hashtags.join(" ")}`)
                            .then(() => toast.success("Copied"))
                        }
                      >
                        Copy
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        {canImage && (
          <TabsContent value="image">
            <Card>
              <CardHeader>
                <CardTitle>Generate images</CardTitle>
                <CardDescription>Results are saved to the media library automatically.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Textarea
                  rows={3}
                  placeholder="Describe the image…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <Button
                  className="w-fit"
                  disabled={busy || !prompt}
                  onClick={async () => {
                    const d = await post("/api/ai/image", { prompt, ...modelParams(imageModel) });
                    if (d) {
                      setImages((s) => [
                        ...d.assets.map((a: { id: string; url: string }) => ({ id: a.id, url: a.url })),
                        ...s,
                      ]);
                      toast.success(`Generated with ${d.model}`);
                    }
                  }}
                >
                  {busy ? "Generating…" : "Generate image"}
                </Button>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {images.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={img.id}
                      src={img.url}
                      alt="Generated"
                      className="aspect-square w-full rounded-md border object-cover"
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
        <TabsContent value="hooks">
          <Card>
            <CardHeader>
              <CardTitle>Hooks, CTAs and hashtags</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Textarea
                rows={4}
                placeholder="Paste a post or topic…"
                value={hookText}
                onChange={(e) => setHookText(e.target.value)}
              />
              <Button
                className="w-fit"
                disabled={busy || !hookText}
                onClick={async () => {
                  const d = await post("/api/ai/hashtags", { text: hookText, platform: platforms[0] ?? "LINKEDIN" });
                  if (d) setHooks(d);
                }}
              >
                Suggest
              </Button>
              {hooks && (
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="mb-2 text-sm font-medium">Hooks</p>
                    <ul className="grid gap-1 text-sm">
                      {hooks.hooks.map((h, i) => (
                        <li key={i} className="rounded border p-2">
                          {h}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">CTAs</p>
                    <ul className="grid gap-1 text-sm">
                      {hooks.ctas.map((h, i) => (
                        <li key={i} className="rounded border p-2">
                          {h}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Hashtags</p>
                    <div className="flex flex-wrap gap-1">
                      {hooks.hashtags.map((h) => (
                        <Badge key={h} variant="secondary">
                          {h}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="calendar">
          <Card>
            <CardHeader>
              <CardTitle>Content calendar</CardTitle>
              <CardDescription>30 days of post ideas across the selected platforms.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Input
                placeholder="Theme, campaign or product focus"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              />
              <Button
                className="w-fit"
                disabled={busy || !theme || platforms.length === 0}
                onClick={async () => {
                  const d = await post("/api/ai/calendar", {
                    theme,
                    platforms,
                    startDate: new Date().toISOString().slice(0, 10),
                    days: 30,
                    postsPerWeek: 3,
                    brandId,
                  });
                  if (d) setCalendar(d.items);
                }}
              >
                Plan
              </Button>
              <div className="grid gap-2">
                {calendar.map((c, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-md border p-2 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground tabular-nums">{c.date}</span>
                    <Badge variant="outline">{c.platform}</Badge>
                    <span>
                      <span className="block font-medium">{c.title}</span>
                      <span className="text-muted-foreground">{c.idea}</span>
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
