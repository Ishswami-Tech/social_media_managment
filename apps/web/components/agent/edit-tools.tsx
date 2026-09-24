"use client";

/**
 * The two ways to change a finished post before approving it: save what you
 * typed, or tell the editor agent what to change. Shared by Home and Review.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Wand2 } from "lucide-react";
import type { PerformanceBadgeProps } from "@/components/agent/performance-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface EditedAccount {
  text: string;
  performance: PerformanceBadgeProps | null;
  note?: string;
}

interface Props {
  runId: string;
  accountId: string;
  /** What the textarea holds right now. */
  text: string;
  /** What the server holds (AI text or the last saved draft). */
  savedText: string;
  disabled?: boolean;
  onUpdated: (account: EditedAccount) => void;
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; message?: string; account?: EditedAccount }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { message?: string; account?: EditedAccount };
    return { ok: res.ok, message: data.message, account: data.account };
  } catch {
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

export function EditTools({ runId, accountId, text, savedText, disabled, onUpdated }: Props) {
  const [instruction, setInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [revising, setRevising] = useState(false);
  const dirty = text.trim() !== savedText.trim();
  const busy = saving || revising || disabled;

  async function save() {
    setSaving(true);
    const { ok, message, account } = await post(`/api/agent/runs/${runId}/edit`, { accountId, editedText: text });
    setSaving(false);
    if (!ok || !account) {
      toast.error(message ?? "Could not save. Try again.");
      return;
    }
    toast.success("Draft saved");
    onUpdated(account);
  }

  async function revise() {
    const asked = instruction.trim();
    if (asked.length < 2) return;
    setRevising(true);
    const { ok, message, account } = await post(`/api/agent/runs/${runId}/revise`, { accountId, instruction: asked });
    setRevising(false);
    if (!ok || !account) {
      toast.error(message ?? "The editor could not do that. Try different wording.");
      return;
    }
    setInstruction("");
    toast.success(account.note ? `Revised: ${account.note}` : "Revised");
    onUpdated(account);
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void revise();
            }
          }}
          placeholder="Tell the editor what to change: shorter, drop the second number, rewrite the hook…"
          maxLength={1000}
          disabled={busy}
          aria-label="Revise with AI"
          className="min-w-[16rem] flex-1"
        />
        <Button size="sm" variant="outline" onClick={() => void revise()} disabled={busy || instruction.trim().length < 2}>
          {revising ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />} Revise with AI
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => void save()} disabled={busy}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save draft
          </Button>
        )}
      </div>
      {dirty && <p className="text-xs text-muted-foreground">Unsaved edit. Save it, or approve and it goes out as written.</p>}
    </div>
  );
}
