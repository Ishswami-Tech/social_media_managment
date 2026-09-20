"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Search, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";
import { PLATFORMS } from "@platform/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  needsSearch: boolean;
}
interface Connector {
  id: string;
  configured: boolean;
  source: "organization" | "platform" | null;
}
export interface Brief {
  title: string;
  summary: string;
  keyPoints: string[];
  angles: { hook: string; why: string }[];
  postIdeas: { platform: string; text: string; hashtags: string[] }[];
  sources: { title: string; url: string; note?: string }[];
  caveats: string[];
}
interface BriefRow {
  id: string;
  skill: string;
  input: string;
  title: string;
  summary: string;
  platforms: string[];
  createdAt: string;
}

export const COMPOSER_SEED_KEY = "composer:seed";

/** Hand a piece of text to the composer (read on mount). */
export function seedComposer(router: ReturnType<typeof useRouter>, text: string, title?: string) {
  try {
    sessionStorage.setItem(COMPOSER_SEED_KEY, JSON.stringify({ text, title }));
  } catch {
    /* private mode: fall through */
  }
  router.push("/create?seed=1");
}

export function ResearchPanel({ onUse, compact = false }: { onUse?: (text: string) => void; compact?: boolean }) {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [history, setHistory] = useState<BriefRow[]>([]);
  const [skillId, setSkillId] = useState("topic-research");
  const [input, setInput] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["LINKEDIN", "INSTAGRAM", "FACEBOOK"]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    brief: Brief;
    trace?: { tool: string; durationMs: number; error: string | null }[];
    provider?: string;
    model?: string;
  } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/ai/research?pageSize=8");
    if (!res.ok) return;
    const d = await res.json();
    setSkills(d.skills);
    setConnectors(d.connectors);
    setHistory(d.items);
  }, []);
  useEffect(() => {
    // Initial fetch of skills, connector status and history; state is set once the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const skill = skills.find((s) => s.id === skillId);
  const searchReady = connectors.some((c) => c.configured);
  const use = (text: string, title?: string) => (onUse ? onUse(text) : seedComposer(router, text, title));

  async function run() {
    if (!input.trim()) return;
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/ai/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId, input, platforms }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Research failed");
    setResult(data);
    load();
  }

  async function open(id: string) {
    const res = await fetch(`/api/ai/research/${id}`);
    if (!res.ok) return;
    const { brief } = await res.json();
    setResult({ id: brief.id, brief: brief.brief, trace: brief.trace, provider: brief.provider, model: brief.model });
  }

  return (
    <div className={compact ? "grid gap-4" : "grid gap-4 lg:grid-cols-[360px_1fr]"}>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="size-4" /> Research
            </CardTitle>
            <CardDescription>
              The AI searches, reads sources and returns a brief with angles, post ideas and citations.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">Skill</Label>
              <Select value={skillId} onValueChange={setSkillId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {skills.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {skill && <p className="text-xs text-muted-foreground">{skill.description}</p>}
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{skill?.inputLabel ?? "Input"}</Label>
              <Input
                placeholder={skill?.inputPlaceholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run()}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Post ideas for</Label>
              <div className="flex flex-wrap gap-3">
                {PLATFORMS.slice(0, 5).map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={platforms.includes(p)}
                      onCheckedChange={(c) => setPlatforms((s) => (c ? [...s, p] : s.filter((x) => x !== p)))}
                    />{" "}
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Wrench className="size-3 text-muted-foreground" />
              {connectors.map((c) => (
                <Badge
                  key={c.id}
                  variant={c.configured ? "success" : "outline"}
                  title={c.source ? `${c.source} key` : "not configured"}
                >
                  {c.id.toLowerCase()}
                </Badge>
              ))}
              <Badge variant="secondary">read_url</Badge>
              <Badge variant="secondary">read_feed</Badge>
              <Badge variant="secondary">brand_knowledge</Badge>
            </div>
            {skill?.needsSearch && !searchReady && (
              <p className="text-xs text-destructive">
                This skill needs a web search connector. Add a Tavily or Brave key in Settings → Research connectors.
              </p>
            )}
            <Button onClick={run} disabled={busy || !input.trim() || (skill?.needsSearch && !searchReady)}>
              <Sparkles /> {busy ? "Researching… (searching and reading sources)" : "Run research"}
            </Button>
          </CardContent>
        </Card>
        {history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent briefs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => open(h.id)}
                  className="rounded-md border p-2 text-left text-sm hover:bg-accent"
                >
                  <span className="block truncate font-medium">{h.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {h.skill} · {formatDate(h.createdAt, { dateStyle: "medium" })}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      <div className="grid content-start gap-4">
        {!result && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {busy
                ? "The agent is searching and reading. This takes 20-60 seconds."
                : "Run a skill to get a sourced brief here."}
            </CardContent>
          </Card>
        )}
        {result && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{result.brief.title}</CardTitle>
                <CardDescription>
                  {result.provider} · {result.model} · {result.trace?.length ?? 0} tool call(s)
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-sm whitespace-pre-wrap">{result.brief.summary}</p>
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() => use(`${result.brief.title}\n\n${result.brief.summary}`, result.brief.title)}
                >
                  Use summary in composer
                </Button>
                {result.brief.keyPoints.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-medium">Key points</p>
                    <ul className="grid gap-1 text-sm">
                      {result.brief.keyPoints.map((k, i) => (
                        <li key={i} className="rounded border p-2">
                          {k}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.brief.angles.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-medium">Angles</p>
                    <ul className="grid gap-1 text-sm">
                      {result.brief.angles.map((a, i) => (
                        <li key={i} className="rounded border p-2">
                          <span className="font-medium">{a.hook}</span>
                          <span className="text-muted-foreground"> — {a.why}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
            {result.brief.postIdeas.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Post ideas</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {result.brief.postIdeas.map((p, i) => (
                    <div key={i} className="grid gap-2 rounded-md border p-3">
                      <Badge variant="outline" className="w-fit">
                        {p.platform}
                      </Badge>
                      <p className="text-sm whitespace-pre-wrap">{p.text}</p>
                      <p className="text-xs text-muted-foreground">{p.hashtags.join(" ")}</p>
                      <Button
                        size="sm"
                        className="w-fit"
                        onClick={() =>
                          use(`${p.text}${p.hashtags.length ? `\n\n${p.hashtags.join(" ")}` : ""}`, result.brief.title)
                        }
                      >
                        Use in composer
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {(result.brief.sources.length > 0 || result.brief.caveats.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Sources & caveats</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  {result.brief.sources.map((s, i) => (
                    <a
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-2 hover:underline"
                    >
                      <ExternalLink className="mt-0.5 size-3 shrink-0" />
                      <span>
                        {s.title}
                        {s.note && <span className="text-muted-foreground"> — {s.note}</span>}
                      </span>
                    </a>
                  ))}
                  {result.brief.caveats.map((c, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      ⚠ {c}
                    </p>
                  ))}
                  {result.trace && result.trace.length > 0 && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Tool calls ({result.trace.length})</summary>
                      <ul className="mt-1 grid gap-0.5">
                        {result.trace.map((t, i) => (
                          <li key={i}>
                            {t.tool} · {t.durationMs} ms{t.error ? ` · error: ${t.error}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
