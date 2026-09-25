"use client";

/**
 * Plans, plural: a list of them down the side, one open at a time. Each plan
 * is a month shaped like a funnel; each idea starts as a campaign with one
 * click and publishes on its date once approved. Plans can be renamed,
 * archived when the month is over, and deleted.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Check, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { ContentPlanView, PlanItemView } from "@/lib/agent/plan";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MicButton } from "@/components/ui/mic-button";

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

const FUNNEL_LABEL: Record<PlanItemView["funnel"], string> = {
  awareness: "Awareness",
  trust: "Trust",
  offer: "Offer",
};

const FUNNEL_CLASS: Record<PlanItemView["funnel"], string> = {
  awareness: "border-sky-500/40 text-sky-700 dark:text-sky-400",
  trust: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  offer: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
};

/** What a started item's campaign is doing, in the words people use. */
function runWords(status: string | undefined): { label: string; tone: string } {
  switch (status) {
    case "AWAITING_APPROVAL":
      return { label: "Ready for review", tone: "text-brand" };
    case "APPROVED":
    case "PUBLISHING":
      return { label: "Publishing", tone: "text-emerald-600 dark:text-emerald-400" };
    case "COMPLETED":
      return { label: "Published", tone: "text-emerald-600 dark:text-emerald-400" };
    case "FAILED":
    case "BLOCKED":
    case "CANCELLED":
      return { label: "Needs attention", tone: "text-destructive" };
    default:
      return { label: "In progress", tone: "text-muted-foreground" };
  }
}

function endDate(plan: ContentPlanView): string {
  const d = new Date(`${plan.startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plan.days - 1);
  return d.toISOString().slice(0, 10);
}

function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

async function call(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ ok: boolean; message?: string; data?: unknown }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: res.ok, message: data.message, data };
  } catch {
    return { ok: false, message: "Could not reach the server. Try again." };
  }
}

function PlanForm({ accounts, onCreated, onCancel }: { accounts: PlanAccount[]; onCreated: (id: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
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
    const { ok, message, data } = await call("/api/agent/plans", "POST", {
      ...(name.trim() ? { name: name.trim() } : {}),
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
    const created = (data as { plan?: { id?: string } } | undefined)?.plan?.id;
    onCreated(created ?? "");
  }

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">New plan</h2>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name (optional), e.g. October launch" />
      <div className="relative">
        <Textarea
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          rows={3}
          maxLength={2000}
          className="pr-10"
          placeholder="What should this month sell or establish? e.g. Get cafe owners to try WhatsApp ordering; we have 3 customer stories and a free setup offer."
        />
        <MicButton value={theme} onChange={setTheme} className="absolute right-2 top-2" />
      </div>
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

function Progress({ plan }: { plan: ContentPlanView }) {
  const started = plan.items.filter((i) => i.runId).length;
  const pct = plan.items.length ? Math.round((started / plan.items.length) * 100) : 0;
  return (
    <span className="block h-1 overflow-hidden rounded-full bg-muted" aria-label={`${started} of ${plan.items.length} started`}>
      <span className="block h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${pct}%` }} />
    </span>
  );
}

function PlanListItem({ plan, selected, onSelect }: { plan: ContentPlanView; selected: boolean; onSelect: () => void }) {
  const started = plan.items.filter((i) => i.runId).length;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "grid w-full gap-1.5 rounded-xl border px-3 py-2.5 text-left transition",
        selected ? "border-brand/50 bg-brand/5" : "bg-card hover:bg-accent",
        plan.status === "ARCHIVED" && "opacity-70",
      )}
    >
      <span className="truncate text-sm font-medium">{plan.name}</span>
      <span className="text-[11px] text-muted-foreground">
        {plan.startDate} → {endDate(plan)} · {started}/{plan.items.length} started
      </span>
      <Progress plan={plan} />
    </button>
  );
}

function PlanDetail({ plan, canStart, onChanged, onDeleted }: { plan: ContentPlanView; canStart: boolean; onChanged: () => void; onDeleted: () => void }) {
  const router = useRouter();
  const [starting, setStarting] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(plan.name);
  const [busy, setBusy] = useState(false);

  async function start(index: number) {
    setStarting(index);
    const { ok, message } = await call(`/api/agent/plans/${plan.id}/start`, "POST", { index });
    setStarting(null);
    if (!ok) {
      toast.error(message ?? "Could not start it. Try again.");
      return;
    }
    toast.success("Started; watch it on Home");
    router.refresh();
  }

  async function rename() {
    const next = name.trim();
    if (!next || next === plan.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const { ok, message } = await call(`/api/agent/plans/${plan.id}`, "PATCH", { name: next });
    setBusy(false);
    if (!ok) {
      toast.error(message ?? "Could not rename it");
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function setStatus(status: "ACTIVE" | "ARCHIVED") {
    setBusy(true);
    const { ok, message } = await call(`/api/agent/plans/${plan.id}`, "PATCH", { status });
    setBusy(false);
    if (!ok) {
      toast.error(message ?? "Could not update it");
      return;
    }
    toast.success(status === "ARCHIVED" ? "Plan archived" : "Plan restored");
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`Delete the plan "${plan.name}"? Campaigns already started keep running.`)) return;
    setBusy(true);
    const { ok, message } = await call(`/api/agent/plans/${plan.id}`, "DELETE");
    setBusy(false);
    if (!ok) {
      toast.error(message ?? "Could not delete it");
      return;
    }
    toast.success("Plan deleted");
    onDeleted();
  }

  const started = plan.items.filter((i) => i.runId).length;
  const ready = plan.items.filter((i) => i.runStatus === "AWAITING_APPROVAL").length;
  const published = plan.items.filter((i) => i.runStatus === "COMPLETED").length;

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus className="h-8 max-w-xs" />
              <Button type="submit" size="sm" disabled={busy}>
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <span className="truncate">{plan.name}</span>
              {plan.status === "ARCHIVED" && <span className="rounded-full border px-1.5 text-[10px] font-normal text-muted-foreground">archived</span>}
              {canStart && (
                <button type="button" onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground" aria-label="Rename plan">
                  <Pencil className="size-3.5" />
                </button>
              )}
            </h2>
          )}
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{plan.theme}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {plan.startDate} → {endDate(plan)} · {plan.items.length} posts · {started} started
            {ready > 0 ? ` · ${ready} ready for review` : ""}
            {published > 0 ? ` · ${published} published` : ""}
          </p>
        </div>
        {canStart && (
          <div className="flex items-center gap-1">
            {plan.status === "ARCHIVED" ? (
              <Button size="sm" variant="outline" onClick={() => void setStatus("ACTIVE")} disabled={busy}>
                <ArchiveRestore aria-hidden /> Restore
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void setStatus("ARCHIVED")} disabled={busy}>
                <Archive aria-hidden /> Archive
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => void remove()} disabled={busy} aria-label="Delete plan">
              <Trash2 aria-hidden />
            </Button>
          </div>
        )}
      </header>
      <Progress plan={plan} />
      <div className="relative grid gap-3 pl-6 before:absolute before:bottom-3 before:left-[9px] before:top-3 before:w-px before:bg-gradient-to-b before:from-brand/60 before:via-border before:to-brand-2/60" role="list">
        {plan.items.map((item, index) => {
          const words = runWords(item.runStatus);
          return (
            <Reveal key={`${item.date}-${index}`} index={index}>
              <div role="listitem" className="relative grid gap-1 rounded-xl border bg-background p-3 text-sm transition hover:-translate-y-0.5 hover:shadow-md md:grid-cols-[7rem_1fr_auto] md:items-start md:gap-3">
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
                    <Link href={`/review/${item.runId}`} className={cn("text-xs underline underline-offset-4", words.tone)}>
                      {words.label} · open
                    </Link>
                  ) : canStart && plan.status !== "ARCHIVED" ? (
                    <Button size="sm" variant="outline" onClick={() => void start(index)} disabled={starting !== null}>
                      {starting === index ? <Loader2 className="animate-spin" aria-hidden /> : null} Write it
                    </Button>
                  ) : null}
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

export function PlanBoard({ accounts, plans, canStart }: Props) {
  const router = useRouter();
  const active = plans.filter((p) => p.status !== "ARCHIVED");
  const archived = plans.filter((p) => p.status === "ARCHIVED");
  const [selectedId, setSelectedId] = useState<string | null>(active[0]?.id ?? null);
  const [creating, setCreating] = useState(plans.length === 0);
  const [showArchived, setShowArchived] = useState(false);
  // A plan that vanished (deleted, or filtered out) hands the spot to the newest one.
  const selected = plans.find((p) => p.id === selectedId) ?? active[0] ?? null;

  const refresh = () => router.refresh();

  return (
    <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-2">
        {canStart && (
          <Button onClick={() => setCreating(true)} className="w-full">
            <Plus aria-hidden /> New plan
          </Button>
        )}
        {active.length === 0 && !creating && <p className="px-1 text-xs text-muted-foreground">No plans yet.</p>}
        {active.map((plan) => (
          <PlanListItem
            key={plan.id}
            plan={plan}
            selected={!creating && plan.id === selected?.id}
            onSelect={() => {
              setSelectedId(plan.id);
              setCreating(false);
            }}
          />
        ))}
        {archived.length > 0 && (
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="mt-2 px-1 text-left text-xs text-muted-foreground underline-offset-4 hover:underline" aria-expanded={showArchived}>
            {showArchived ? "Hide archived" : `Archived (${archived.length})`}
          </button>
        )}
        {showArchived &&
          archived.map((plan) => (
            <PlanListItem
              key={plan.id}
              plan={plan}
              selected={!creating && plan.id === selected?.id}
              onSelect={() => {
                setSelectedId(plan.id);
                setCreating(false);
              }}
            />
          ))}
      </aside>

      <div className="min-w-0">
        {creating || !selected ? (
          canStart ? (
            <PlanForm
              accounts={accounts}
              onCreated={(id) => {
                setCreating(false);
                if (id) setSelectedId(id);
                refresh();
              }}
              onCancel={plans.length > 0 ? () => setCreating(false) : undefined}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No plan yet.</p>
          )
        ) : (
          <PlanDetail
            key={selected.id}
            plan={selected}
            canStart={canStart}
            onChanged={refresh}
            onDeleted={() => {
              setSelectedId(null);
              refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
