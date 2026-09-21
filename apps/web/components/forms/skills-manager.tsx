"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  sourceUrl: string | null;
  enabled: boolean;
  /** Injected into every AI call (generate, rewrite, hashtags, calendar), not only research runs. */
  autoApply: boolean;
  updatedAt: string;
}

const EXAMPLE_REPO = "https://github.com/sergebulaev/linkedin-skills";

/**
 * Settings → Skills: import Agent-Skills playbooks (SKILL.md + references)
 * from GitHub or paste one by hand. Enabled skills show up in the composer's
 * "+" menu and the Research dialog, where the model follows their instructions.
 */
export function SkillsManager({ skills }: { skills: SkillRow[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ name: "", description: "", markdown: "" });

  async function request(method: string, body: unknown) {
    setBusy(true);
    const res = await fetch("/api/organizations/skills", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as { message?: string; skills?: SkillRow[] };
    if (!res.ok) {
      toast.error(data.message ?? "Request failed");
      return null;
    }
    router.refresh();
    return data;
  }

  async function importFromUrl() {
    const data = await request("POST", { url: url.trim() });
    if (!data) return;
    toast.success(`Imported ${data.skills?.length ?? 0} skill(s)`);
    setUrl("");
  }

  async function addManual() {
    const data = await request("POST", manual);
    if (!data) return;
    toast.success(`Added ${manual.name}`);
    setManual({ name: "", description: "", markdown: "" });
    setShowManual(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        <CardDescription>
          Playbooks the AI follows when researching and writing. Import any repository of Agent Skills (a
          <code className="mx-1 rounded bg-muted px-1">SKILL.md</code>
          per skill, optionally with <code className="mx-1 rounded bg-muted px-1">references/</code>), or write your
          own. Enabled skills appear in the composer&apos;s + menu and in Research; &quot;always&quot; injects a skill
          into every AI call (generate, rewrite, shorten, expand, hashtags, calendar).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="skill-url">Import from GitHub</Label>
          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              id="skill-url"
              placeholder={EXAMPLE_REPO}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button onClick={importFromUrl} disabled={busy || !url.trim()}>
              {busy ? "Importing…" : "Import"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A repository, a folder inside it, or a single SKILL.md link. Re-importing updates existing skills with the
            same name.
          </p>
        </div>

        {skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">No custom skills yet. Built-in research skills are always available.</p>
        ) : (
          <div className="grid gap-2">
            {skills.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge variant="outline">{s.slug}</Badge>
                    {!s.enabled && <Badge variant="secondary">disabled</Badge>}
                  </div>
                  {s.description && <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>}
                  {s.sourceUrl && (
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                      source
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Inject into every AI call">
                    <Switch
                      checked={s.autoApply}
                      onCheckedChange={(autoApply) => request("PATCH", { id: s.id, autoApply })}
                      disabled={busy || !s.enabled}
                      aria-label={`Always apply ${s.name}`}
                    />
                    always
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Available to pick">
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={(enabled) => request("PATCH", { id: s.id, enabled })}
                      disabled={busy}
                      aria-label={`Enable ${s.name}`}
                    />
                    on
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`Delete the skill "${s.name}"?`)) return;
                      if (await request("DELETE", { id: s.id })) toast.success("Skill deleted");
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!showManual ? (
          <Button variant="outline" onClick={() => setShowManual(true)}>
            + Write a skill by hand
          </Button>
        ) : (
          <div className="grid gap-3 rounded-md border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1">
                <Label>Name</Label>
                <Input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label>Description</Label>
                <Input
                  value={manual.description}
                  onChange={(e) => setManual({ ...manual, description: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Instructions (markdown; a full SKILL.md with frontmatter also works)</Label>
              <Textarea
                rows={10}
                value={manual.markdown}
                onChange={(e) => setManual({ ...manual, markdown: e.target.value })}
                placeholder={"# Role\nYou are...\n\n## Process\n1. ...\n\n## Output format\n..."}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={addManual} disabled={busy || !manual.name.trim() || manual.markdown.trim().length < 20}>
                Save skill
              </Button>
              <Button variant="ghost" onClick={() => setShowManual(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
