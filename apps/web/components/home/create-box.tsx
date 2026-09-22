"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface CreateBoxAccount {
  id: string;
  platform: string;
  displayName: string;
}

interface Props {
  accounts: CreateBoxAccount[];
  /** `content:create` — the manual composer. */
  canWriteYourself: boolean;
}

interface CreateResponse {
  run?: { id: string };
  message?: string;
}

/** The API accepts at most ten accounts per request. */
const MAX_ACCOUNTS = 10;
const DEFAULT_GOAL = "Engage my audience";

export function CreateBox({ accounts, canWriteYourself }: Props) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [selected, setSelected] = useState<string[]>(() => accounts.slice(0, MAX_ACCOUNTS).map((a) => a.id));
  const [busy, setBusy] = useState(false);

  if (accounts.length === 0) {
    return (
      <section className="grid gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">What do you want to post about?</h2>
        <p className="text-sm text-muted-foreground">
          Connect a social account first and we can write and publish for you.
        </p>
        <Button asChild className="justify-self-start">
          <Link href="/accounts">Connect an account</Link>
        </Button>
      </section>
    );
  }

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const tooMany = selected.length > MAX_ACCOUNTS;
  const ready = topic.trim().length >= 3 && selected.length > 0 && !tooMany;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    const res = await fetch("/api/agent/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic: topic.trim(),
        goal: goal.trim() || DEFAULT_GOAL,
        socialAccountIds: selected,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as CreateResponse;
    if (!res.ok || !data.run) {
      setBusy(false);
      toast.error(data.message ?? "Could not start writing. Try again.");
      return;
    }
    router.push(`/review/${data.run.id}`);
  }

  return (
    <section className="grid gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">What do you want to post about?</h2>
      <Textarea
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        rows={4}
        maxLength={500}
        disabled={busy}
        placeholder="A tip, an announcement, a story — anything."
        aria-label="What do you want to post about?"
        className="text-base"
      />
      <Input
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        maxLength={500}
        disabled={busy}
        placeholder="Add a goal or audience (optional)"
        aria-label="Add a goal or audience (optional)"
      />
      <div className="flex flex-wrap gap-2">
        {accounts.map((a) => {
          const on = selected.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => toggle(a.id)}
              aria-pressed={on}
              disabled={busy}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-60",
                on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              <PlatformIcon platform={a.platform} className="size-5 text-[9px]" />
              <span className="max-w-40 truncate">{a.displayName}</span>
            </button>
          );
        })}
      </div>
      {tooMany && (
        <p className="text-sm text-muted-foreground">Pick at most {MAX_ACCOUNTS} accounts at a time.</p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={submit} disabled={!ready || busy} size="lg">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Creating…
            </>
          ) : (
            "Create with AI"
          )}
        </Button>
        {canWriteYourself && (
          <Link href="/create" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Write it yourself
          </Link>
        )}
      </div>
    </section>
  );
}
