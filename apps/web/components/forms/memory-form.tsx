"use client";

/**
 * What the AI knows about one account, editable in plain lists (one item per
 * line), with the parts the learning loop owns shown read-only next to it.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { AccountMemory, MemoryInput } from "@/lib/services/memory";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const toLines = (items: readonly string[]): string => items.join("\n");
const fromLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

function ListField({
  label,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  hint?: string;
  value: readonly string[];
  onChange: (items: string[]) => void;
  rows?: number;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <Textarea rows={rows} defaultValue={toLines(value)} onBlur={(e) => onChange(fromLines(e.target.value))} placeholder="One per line" />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input defaultValue={value ?? ""} onBlur={(e) => onChange(e.target.value)} maxLength={300} />
    </label>
  );
}

export function MemoryForm({ memory, canEdit }: { memory: AccountMemory; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<MemoryInput>(memory.editable);
  const [busy, setBusy] = useState(false);
  const [forgetting, setForgetting] = useState<number | null>(null);

  const patch = <K extends keyof MemoryInput>(section: K, update: Partial<MemoryInput[K]>) =>
    setDraft((d) => ({ ...d, [section]: { ...d[section], ...update } }));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/${memory.account.id}/memory`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "Could not save");
      toast.success("Memory updated");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function forget(index: number) {
    setForgetting(index);
    try {
      const res = await fetch(`/api/accounts/${memory.account.id}/memory`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forgetPreference: index }),
      });
      if (!res.ok) throw new Error("Could not forget that");
      toast.success("Forgotten");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not forget that");
    } finally {
      setForgetting(null);
    }
  }

  const learned = memory.learned;
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4">
      <header className="flex items-center gap-2">
        <PlatformIcon platform={memory.account.platform} />
        <h2 className="text-base font-semibold">{memory.account.displayName}</h2>
      </header>

      <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Who this account is</h3>
          <TextField label="Brand" value={draft.identity.brand} onChange={(brand) => patch("identity", { brand })} />
          <TextField label="Industry" value={draft.identity.industry} onChange={(industry) => patch("identity", { industry })} />
          <TextField label="Positioning" value={draft.identity.positioning} onChange={(positioning) => patch("identity", { positioning })} />
          <ListField label="Products or services" value={draft.identity.products} onChange={(products) => patch("identity", { products })} />
          <h3 className="text-sm font-semibold text-muted-foreground">Who it talks to</h3>
          <ListField label="Personas" value={draft.audience.personas} onChange={(personas) => patch("audience", { personas })} />
          <ListField label="Pain points" value={draft.audience.painPoints} onChange={(painPoints) => patch("audience", { painPoints })} />
          <ListField label="What they want" value={draft.audience.desiredOutcomes} onChange={(desiredOutcomes) => patch("audience", { desiredOutcomes })} />
        </div>
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">How it sounds</h3>
          <TextField label="Tone" value={draft.voice.tone} onChange={(tone) => patch("voice", { tone })} />
          <TextField label="Sentence style" value={draft.voice.sentenceStyle} onChange={(sentenceStyle) => patch("voice", { sentenceStyle })} />
          <ListField label="Words it uses" value={draft.voice.vocabulary} onChange={(vocabulary) => patch("voice", { vocabulary })} />
          <ListField label="Never say" hint="Also blocked by the checks" value={draft.voice.forbiddenLanguage} onChange={(forbiddenLanguage) => patch("voice", { forbiddenLanguage })} />
          <ListField label="Example posts in this voice" value={draft.voice.examples} onChange={(examples) => patch("voice", { examples })} rows={4} />
          <h3 className="text-sm font-semibold text-muted-foreground">What it talks about</h3>
          <ListField label="Content pillars" value={draft.content.pillars} onChange={(pillars) => patch("content", { pillars })} />
          <ListField label="Preferred calls to action" value={draft.content.ctaPreferences} onChange={(ctaPreferences) => patch("content", { ctaPreferences })} />
          <ListField label="Never talk about" value={draft.content.forbiddenTopics} onChange={(forbiddenTopics) => patch("content", { forbiddenTopics })} />
        </div>
      </fieldset>

      {canEdit && (
        <div>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />} Save memory
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <h3 className="mb-1 font-medium">Learned from results</h3>
          {learned && (learned.sampleSize ?? 0) > 0 ? (
            <ul className="grid gap-1 text-xs text-muted-foreground">
              <li>
                {learned.sampleSize} published posts measured · confidence {Math.round((learned.confidence ?? 0) * 100)}%
                {memory.learnedAt ? ` · updated ${new Date(memory.learnedAt).toLocaleDateString()}` : ""}
              </li>
              {learned.bestHooks?.length ? <li>Hooks that work: {learned.bestHooks.join(", ")}</li> : null}
              {learned.bestFormats?.length ? <li>Formats that work: {learned.bestFormats.join(", ")}</li> : null}
              {learned.bestCtas?.length ? <li>Calls to action that work: {learned.bestCtas.join(", ")}</li> : null}
              {learned.bestTopics?.length ? <li>Topics that work: {learned.bestTopics.join(", ")}</li> : null}
              {learned.bestPostingWindows?.length ? <li>Best posting windows: {learned.bestPostingWindows.join(", ")}</li> : null}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nothing yet. After a few published posts with results, the AI records which hooks, formats and calls to action perform best here.
            </p>
          )}
        </div>
        <div className="rounded-md bg-muted/40 p-3 text-sm">
          <h3 className="mb-1 font-medium">Learned from your edits and rejections</h3>
          {memory.feedback.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing yet. Edits before approval and rejection notes become preferences the writers follow.</p>
          ) : (
            <ul className="grid gap-1 text-xs">
              {memory.feedback.map((p, i) => (
                <li key={`${p.at}-${i}`} className="flex items-start justify-between gap-2">
                  <span>
                    {p.text} <span className="text-muted-foreground">({p.source})</span>
                  </span>
                  {canEdit && (
                    <button type="button" className="shrink-0 text-muted-foreground underline-offset-4 hover:underline" onClick={() => void forget(i)} disabled={forgetting === i}>
                      Forget
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
