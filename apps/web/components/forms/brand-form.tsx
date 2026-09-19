"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Brand {
  id?: string;
  name: string;
  industry: string;
  audience: string;
  tone: string;
  language: string;
  rules: { do?: string[]; dont?: string[]; bannedPhrases?: string[] };
  voiceExamples: string[];
  knowledge: { title: string; content: string }[];
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function BrandForm({
  brand,
  canEdit,
  defaultName,
}: {
  brand: Brand | null;
  canEdit: boolean;
  defaultName: string;
}) {
  const router = useRouter();
  const [b, setB] = useState<Brand>(
    brand ?? {
      name: defaultName,
      industry: "",
      audience: "",
      tone: "",
      language: "en",
      rules: {},
      voiceExamples: [],
      knowledge: [],
    },
  );
  const [doText, setDo] = useState((b.rules.do ?? []).join("\n"));
  const [dontText, setDont] = useState((b.rules.dont ?? []).join("\n"));
  const [banned, setBanned] = useState((b.rules.bannedPhrases ?? []).join("\n"));
  const [examples, setExamples] = useState(b.voiceExamples.join("\n---\n"));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/brand", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: b.id,
        name: b.name,
        industry: b.industry || undefined,
        audience: b.audience || undefined,
        tone: b.tone || undefined,
        language: b.language,
        rules: { do: lines(doText), dont: lines(dontText), bannedPhrases: lines(banned) },
        voiceExamples: examples
          .split(/\n---\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        isDefault: true,
        knowledge: b.knowledge.filter((k) => k.content.trim()),
      }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) return toast.error(data.message ?? "Save failed");
    toast.success("Brand saved");
    router.refresh();
  }

  const set = (k: keyof Brand, v: string) => setB((s) => ({ ...s, [k]: v }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1">
            <Label>Brand name</Label>
            <Input value={b.name} onChange={(e) => set("name", e.target.value)} disabled={!canEdit} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>Industry</Label>
              <Input value={b.industry} onChange={(e) => set("industry", e.target.value)} disabled={!canEdit} />
            </div>
            <div className="grid gap-1">
              <Label>Language</Label>
              <Input value={b.language} onChange={(e) => set("language", e.target.value)} disabled={!canEdit} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Audience</Label>
            <Textarea
              rows={2}
              value={b.audience}
              onChange={(e) => set("audience", e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="grid gap-1">
            <Label>Tone of voice</Label>
            <Textarea
              rows={2}
              placeholder="e.g. Confident, warm, plain-spoken. No jargon."
              value={b.tone}
              onChange={(e) => set("tone", e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>One per line.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1">
            <Label>Always</Label>
            <Textarea rows={3} value={doText} onChange={(e) => setDo(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="grid gap-1">
            <Label>Never</Label>
            <Textarea rows={3} value={dontText} onChange={(e) => setDont(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="grid gap-1">
            <Label>Banned phrases</Label>
            <Textarea rows={2} value={banned} onChange={(e) => setBanned(e.target.value)} disabled={!canEdit} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Voice examples</CardTitle>
          <CardDescription>Paste up to 5 approved posts, separated by a line containing only ---</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea rows={10} value={examples} onChange={(e) => setExamples(e.target.value)} disabled={!canEdit} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Knowledge base</CardTitle>
          <CardDescription>
            Product facts, FAQs, offers. Retrieved by keyword when generating and when suggesting WhatsApp replies.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {b.knowledge.map((k, i) => (
            <div key={i} className="grid gap-1 rounded-md border p-2">
              <Input
                placeholder="Title"
                value={k.title}
                onChange={(e) =>
                  setB((s) => ({
                    ...s,
                    knowledge: s.knowledge.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                  }))
                }
                disabled={!canEdit}
              />
              <Textarea
                rows={3}
                placeholder="Content"
                value={k.content}
                onChange={(e) =>
                  setB((s) => ({
                    ...s,
                    knowledge: s.knowledge.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)),
                  }))
                }
                disabled={!canEdit}
              />
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-fit"
                  onClick={() => setB((s) => ({ ...s, knowledge: s.knowledge.filter((_, j) => j !== i) }))}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          {canEdit && (
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => setB((s) => ({ ...s, knowledge: [...s.knowledge, { title: "", content: "" }] }))}
            >
              Add entry
            </Button>
          )}
        </CardContent>
      </Card>
      {canEdit && (
        <div className="lg:col-span-2">
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save brand"}
          </Button>
        </div>
      )}
    </div>
  );
}
