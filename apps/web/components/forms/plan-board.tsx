"use client";

/**
 * Plan a month: theme in, a funnel-shaped list of post ideas out. Each idea
 * starts as a campaign with one click and publishes on its date once approved.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Sparkles } from "lucide-react";
import type { ContentPlanView, PlanItem } from "@/lib/agent/plan";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface PlanAccount {
  id: string;
  platform: string;
  displayName: string;
}

interface Props {
  accounts: PlanAccount[];
  plans: ContentPlanView[];
  canStart: boolean;
}

const FUNNEL_LABEL: Record<PlanItem["funnel"], string> = {
  awareness: "Awareness",
  trust: "Trust",
  offer: "Offer",
};

const FUNNEL_CLASS: Record<PlanItem["funnel"], string> = {
  awareness: "border-sky-500/40 text-sky-700 dark:text-sky-400",
  trust: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  offer: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
};

function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; message?: string; data?: unknown }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: res.ok, message: data.message, data };
  } catch {
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

function PlanForm({ accounts, onCreated }: { accounts: PlanAccount[]; onCreated: () => void }) {
  const [theme, setTheme] = useState("");
  const [audience, setAudience] = useState("");
  const [selected, setSelected] = useState<string[]>(accounts.map((a) => a.id));
  const [startDate, setStartDate] = useState(nextMonday);
  const [weeks, setWeeks] = useState(4);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [busy, setBusy] = useState(false);
  const ready = theme.trim().length >= 3 && selected.length > 0;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    const { ok, message } = await post("/api/agent/plans", {
      theme: theme.trim(),
      ...(audience.trim() ? { audience: audience.trim() } : {}),
      socialAccountIds: selected,
      startDate,
      days: weeks * 7,
      postsPerWeek,
    });
    setBusy(false);
    if (!ok) {
      toast.error(message ?? "Could not plan. Try again.");
      return;
    }
    toast.success("Your month is planned");
    setTheme("");
    onCreated();
  }

  return (
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_18px_50px_-30px_rgba(80,60,200,0.35)] dark:border-border">
      <h2 className="text-base font-semibold">Plan a month</h2>
      <Textarea
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="What should this month sell or establish? e.g. Get cafe owners to try WhatsApp ordering; we have 3 customer stories and a free setup offer."
      />
      <Input value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={500} placeholder="Audience (optional), e.g. independent cafe owners in Pune" />
      <div className="flex flex-wrap items-center gap-2">
        {accounts.map((a) => {
          const on = selected.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelected((s) => (on ? s.filter((id) => id !== a.id) : [...s, a.id]))}
              aria-pressed={on}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs", on ? "bg-primary/10 border-primary/40" : "text-muted-foreground")}
            >
              {on && <Check className="size-3" aria-hidden />}
              <PlatformIcon platform={a.platform} className="size-4 text-[8px]" />
              {a.displayName}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Start</span>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Weeks</span>
          <Input type="number" min={1} max={8} value={weeks} onChange={(e) => setWeeks(Math.min(8, Math.max(1, Number(e.target.value) || 1)))} className="w-20" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Posts per week</span>
          <Input type="number" min={1} max={7} value={postsPerWeek} onChange={(e) => setPostsPerWeek(Math.min(7, Math.max(1, Number(e.target.value) || 1)))} className="w-24" />
        </label>
        <Button onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} Plan it
        </Button>
      </div>
    </section>
  );
}

function PlanCard({ plan, canStart }: { plan: ContentPlanView; canStart: boolean }) {
  const router = useRouter();
  const [starting, setStarting] = useState<number | null>(null);

  async function start(index: number) {
    setStarting(index);
    const { ok, message } = await post(`/api/agent/plans/${plan.id}/start`, { index });
    setStarting(null);
    if (!ok) {
      toast.error(message ?? "Could not start it. Try again.");
      return;
    }
    toast.success("Started; watch it on Home");
    router.refresh();
  }

  const started = plan.items.filter((i) => i.runId).length;
  return (
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_18px_50px_-30px_rgba(80,60,200,0.35)] dark:border-border">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{plan.theme}</h2>
          <p className="text-xs text-muted-foreground">
            From {plan.startDate} · {plan.items.length} posts · {started} started
          </p>
        </div>
      </header>
      <div className="relative grid gap-3 pl-6 before:absolute before:bottom-3 before:left-[9px] before:top-3 before:w-px before:bg-gradient-to-b before:from-brand/60 before:via-border before:to-brand-2/60" role="list">
        {plan.items.map((item, index) => (
          <Reveal key={`${item.date}-${index}`} index={index}>
            <div role="listitem" className="relative grid gap-1 rounded-xl border border-border bg-card p-3 text-sm shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:grid-cols-[7rem_1fr_auto] md:items-start md:gap-3 dark:border-border">
            <span aria-hidden className={cn("absolute -left-6 top-4 size-[11px] rounded-full ring-4 ring-background", item.runId ? "bg-emerald-500" : "bg-gradient-to-br from-brand to-brand-2")} />
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{item.date}</span>
              <span className={cn("w-fit rounded-full border px-1.5", FUNNEL_CLASS[item.funnel])}>{FUNNEL_LABEL[item.funnel]}</span>
              <span className="inline-flex items-center gap-1">
                <PlatformIcon platform={item.platform} className="size-4 text-[8px]" /> {item.format}
              </span>
            </div>
            <div className="grid gap-0.5">
              <p className="font-medium">{item.title}</p>
              <p className="text-muted-foreground">{item.idea}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Goal: </span>
                {item.goal}
              </p>
            </div>
            <div className="md:pt-1">
              {item.runId ? (
                <Link href={`/review/${item.runId}`} className="text-xs underline underline-offset-4">
                  Started · open
                </Link>
              ) : canStart ? (
                <Button size="sm" variant="outline" onClick={() => void start(index)} disabled={starting !== null}>
                  {starting === index ? <Loader2 className="animate-spin" aria-hidden /> : null} Write it
                </Button>
              ) : null}
            </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function PlanBoard({ accounts, plans, canStart }: Props) {
  const router = useRouter();
  return (
    <div className="grid gap-6">
      {canStart && <PlanForm accounts={accounts} onCreated={() => router.refresh()} />}
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plan yet. Describe what the month should achieve and let the planner lay it out.</p>
      ) : (
        plans.map((plan) => <PlanCard key={plan.id} plan={plan} canStart={canStart} />)
      )}
    </div>
  );
}
