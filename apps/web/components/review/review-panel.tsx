"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/app/platform-icon";
import { PerformanceBadge, type PerformanceBadgeProps } from "@/components/agent/performance-badge";
import { EditTools, type EditedAccount } from "@/components/agent/edit-tools";
import { PostPreview } from "@/components/preview/post-preview";
import { AlertTriangle, Check, CheckCheck, Eye, Loader2, Pencil, RefreshCw, X } from "lucide-react";
import { AGENTS } from "@/components/agent/agents";
import { cn, dayLabel, timeLabel } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface ReviewSource {
  id: string;
  title: string;
  url: string | null;
}

export interface ReviewAccount {
  /** AgentRunAccount id. */
  id: string;
  platform: string;
  displayName: string;
  avatarUrl: string | null;
  /** Final text with hashtags, ready to edit. Empty while the text is still being written. */
  text: string;
  /** One line explaining the angle that was chosen. */
  why: string | null;
  /** Generated image attached to the recommendation, when there is one. */
  image: { url: string; alt: string } | null;
  /** Expected-reach estimate once the text is final. */
  performance: PerformanceBadgeProps | null;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  decisionComment: string | null;
  postId: string | null;
  error: string | null;
}

interface Props {
  runId: string;
  status: string;
  accounts: ReviewAccount[];
  sources: ReviewSource[];
  unverifiedCount: number;
  /** `content:approve`, the text is awaiting a decision, and it is not the viewer's own. */
  canDecide: boolean;
  /** `content:create` — pause, stop and try again. */
  canManage: boolean;
  /**
   * Render only Pause/Resume/Stop/Try again, without the per-account texts.
   * The review screen uses this while the AI is still working, so those
   * controls are reachable before there is anything to read.
   */
  controlsOnly?: boolean;
}

interface ErrorBody {
  message?: string;
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as ErrorBody;
  return { ok: res.ok, message: data.message };
}

/** States the worker can still be asked to stop. */
const STOPPABLE = new Set([
  "QUEUED",
  "RESEARCHING",
  "STRATEGIZING",
  "DRAFTING",
  "REVIEWING",
  "JUDGING",
  "ADAPTING",
  "AWAITING_APPROVAL",
  "APPROVED",
]);

const QUIET_ACTION = "text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50";

function Sources({ sources, unverifiedCount }: { sources: ReviewSource[]; unverifiedCount: number }) {
  if (sources.length === 0 && unverifiedCount === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">Sources: </span>
      {sources.length === 0 ? (
        <span>none yet</span>
      ) : (
        sources.map((s, i) => (
          <span key={s.id}>
            {i > 0 && ", "}
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {s.title}
              </a>
            ) : (
              s.title
            )}
          </span>
        ))
      )}
      {unverifiedCount > 0 && <span> · {unverifiedCount} point(s) we could not verify</span>}
    </p>
  );
}

function AccountBlock({
  runId,
  account,
  sources,
  unverifiedCount,
  canDecide,
  editable,
}: {
  runId: string;
  account: ReviewAccount;
  sources: ReviewSource[];
  unverifiedCount: number;
  canDecide: boolean;
  /** The run is waiting for approval, so the text may still change. */
  editable: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(account.text);
  const [savedText, setSavedText] = useState(account.text);
  const [performance, setPerformance] = useState(account.performance);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  // After a refresh (judge override, another person's edit) the server's text wins.
  const [seen, setSeen] = useState(account.text);
  if (seen !== account.text) {
    setSeen(account.text);
    setText(account.text);
    setSavedText(account.text);
    setPerformance(account.performance);
  }

  function applyEdit(edited: EditedAccount) {
    setText(edited.text);
    setSavedText(edited.text);
    setPerformance(edited.performance);
  }

  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(true);
    const edited = decision === "APPROVED" && text.trim() !== savedText.trim() ? { editedText: text } : {};
    const { ok, message } = await post(`/api/agent/runs/${runId}/decide`, {
      accountIds: [account.id],
      decision,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...edited,
    });
    setBusy(false);
    if (!ok) {
      toast.error(message ?? "That did not work. Try again.");
      return;
    }
    toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
    setComment("");
    router.refresh();
  }

  return (
    <article className="grid gap-4 rounded-xl border border-border bg-card p-5">
      <header className="flex flex-wrap items-center gap-2">
        <PlatformIcon platform={account.platform} />
        <span className="font-display text-[15px] font-semibold">{account.displayName}</span>
        {account.decision === "PENDING" ? (
          <Badge variant="signal">Ready for you</Badge>
        ) : (
          <Badge variant={account.decision === "APPROVED" ? "success" : "danger"}>
            {account.decision === "APPROVED" ? "Approved" : "Rejected"}
          </Badge>
        )}
        {account.postId && (
          <Link href={`/posts/${account.postId}`} className="text-xs underline underline-offset-4">
            Published as post
          </Link>
        )}
      </header>

      {account.text ? (
        <div className="grid gap-2">
          {editing ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              maxLength={65000}
              aria-label={`Post text for ${account.displayName}`}
              readOnly={!canDecide}
              className="text-base"
            />
          ) : (
            <PostPreview
              platform={account.platform}
              account={{ displayName: account.displayName, avatarUrl: account.avatarUrl }}
              text={text}
              media={account.image ? [{ id: "image", url: account.image.url, alt: account.image.alt }] : []}
            />
          )}
          {canDecide && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {editing ? <Eye className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
              {editing ? "Preview" : "Edit text"}
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">The text is still being written.</p>
      )}

      {performance && <PerformanceBadge {...performance} />}

      {canDecide && editable && account.text && (
        <EditTools runId={runId} accountId={account.id} text={text} savedText={savedText} disabled={busy} onUpdated={applyEdit} />
      )}

      {account.why && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Why this post: </span>
          {account.why}
        </p>
      )}
      <Sources sources={sources} unverifiedCount={unverifiedCount} />

      {account.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{account.error}</p>}
      {account.decisionComment && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Your note: </span>
          {account.decisionComment}
        </p>
      )}

      {canDecide && account.text && (
        <div className="grid gap-2">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a note (optional)"
            maxLength={2000}
            aria-label={`Note for ${account.displayName}`}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="signal" disabled={busy} onClick={() => decide("APPROVED")}>
              Approve
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => decide("REJECTED")}>
              Reject
            </Button>
          </div>
          {text.trim() !== savedText.trim() && (
            <p className="text-xs text-muted-foreground">Your edit goes out with the approval.</p>
          )}
        </div>
      )}
    </article>
  );
}

export function ReviewPanel({
  runId,
  status,
  accounts,
  sources,
  unverifiedCount,
  canDecide,
  canManage,
  controlsOnly = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(action: string, message: string) {
    setBusy(true);
    const result = await post(`/api/agent/runs/${runId}/${action}`);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "That did not work. Try again.");
      return;
    }
    toast.success(message);
    router.refresh();
  }

  const canPause = canManage && STOPPABLE.has(status);
  const canResume = canManage && (status === "PAUSED" || status === "BLOCKED");
  const canStop = canManage && (STOPPABLE.has(status) || status === "PAUSED" || status === "BLOCKED");
  const canRetry = canManage && status === "FAILED";
  const pending = accounts.filter((a) => a.decision === "PENDING" && a.text);

  async function approveAll() {
    setBusy(true);
    const result = await post(`/api/agent/runs/${runId}/decide`, {
      accountIds: pending.map((a) => a.id),
      decision: "APPROVED",
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "That did not work. Try again.");
      return;
    }
    toast.success(`Approved all ${pending.length} posts`);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {!controlsOnly && canDecide && pending.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-signal/30 bg-signal-soft px-5 py-3">
          <p className="text-[14px] text-signal-ink">
            {pending.length} posts are ready. Approve them as written, or decide each one below.
          </p>
          <Button variant="signal" size="sm" disabled={busy} onClick={() => void approveAll()}>
            <CheckCheck aria-hidden /> Approve all {pending.length}
          </Button>
        </div>
      )}
      {!controlsOnly && accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">No accounts were picked for this one.</p>
      )}
      {!controlsOnly &&
        accounts.map((a) => (
          <AccountBlock
            key={a.id}
            runId={runId}
            account={a}
            sources={sources}
            unverifiedCount={unverifiedCount}
            canDecide={canDecide && a.decision === "PENDING"}
            editable={status === "AWAITING_APPROVAL"}
          />
        ))}

      {(canPause || canResume || canStop || canRetry) && (
        <div className="flex flex-wrap gap-4 text-sm">
          {canPause && (
            <button type="button" disabled={busy} onClick={() => act("pause", "Paused")} className={QUIET_ACTION}>
              Pause
            </button>
          )}
          {canResume && (
            <button type="button" disabled={busy} onClick={() => act("resume", "Resumed")} className={QUIET_ACTION}>
              Resume
            </button>
          )}
          {canRetry && (
            <button type="button" disabled={busy} onClick={() => act("retry", "Trying again")} className={QUIET_ACTION}>
              Try again
            </button>
          )}
          {canStop && (
            <button type="button" disabled={busy} onClick={() => act("cancel", "Stopped")} className={QUIET_ACTION}>
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The review workspace (design: tabs per account, preview/edit, when it goes
// out, decision buttons, and the evidence on the right)
// ---------------------------------------------------------------------------

export interface WorkspaceCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface WorkspaceAccount extends ReviewAccount {
  /** Text the editor (Polish) produced, before any of your edits. */
  polishText: string;
  accountType: string;
  angle: { summary: string | null; rows: { label: string; value: string }[] };
  scores: { label: string; score: number | null; winner: boolean }[];
  rationale: string | null;
  checks: WorkspaceCheck[];
  bestWindow: string | null;
  mediaConcept: string | null;
}

export interface WorkspaceProps {
  runId: string;
  status: string;
  accounts: WorkspaceAccount[];
  canDecide: boolean;
  scheduledAt: string | null;
  timeZone: string;
  maxChars: Record<string, number>;
  title: string;
  /** Goal, audience, assurance, spend, when it became ready. */
  chips: string[];
  claims: { id: string; statement: string; supported: boolean; source: string }[];
}

type When = "planned" | "pick" | "now";

function charCount(text: string): string {
  return text.length.toLocaleString("en-US");
}

export function ReviewWorkspace({ runId, status, accounts, canDecide, scheduledAt, timeZone, maxChars, title, chips, claims }: WorkspaceProps) {
  const router = useRouter();
  const [tab, setTab] = useState(accounts.find((a) => a.decision === "PENDING")?.id ?? accounts[0]?.id ?? "");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(accounts.map((a) => [a.id, a.text])));
  const [saved, setSaved] = useState<Record<string, string>>(() => Object.fromEntries(accounts.map((a) => [a.id, a.text])));
  const [when, setWhen] = useState<When>("planned");
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const account = accounts.find((a) => a.id === tab) ?? accounts[0];
  if (!account) return <p className="text-sm text-muted-foreground">No accounts were picked for this one.</p>;
  const text = texts[account.id] ?? "";
  const pending = accounts.filter((a) => a.decision === "PENDING" && a.text);
  const decidable = canDecide && account.decision === "PENDING" && Boolean(account.text) && status === "AWAITING_APPROVAL";
  const limit = maxChars[account.platform] ?? 3000;
  const checksClear = account.checks.filter((c) => c.ok).length;

  function publishAt(): string | undefined | null {
    if (when === "now") return new Date(Date.now() + 60_000).toISOString();
    if (when === "pick") {
      if (!pick) return null;
      const d = new Date(pick);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return undefined;
  }

  async function decide(ids: string[], decision: "APPROVED" | "REJECTED") {
    const at = decision === "APPROVED" ? publishAt() : undefined;
    if (at === null) return toast.error("Pick a date and time first.");
    setBusy(true);
    const single = ids.length === 1 ? ids[0]! : null;
    const edited = single && decision === "APPROVED" && (texts[single] ?? "").trim() !== (saved[single] ?? "").trim() ? { editedText: texts[single] } : {};
    const r = await post(`/api/agent/runs/${runId}/decide`, {
      accountIds: ids,
      decision,
      ...(note.trim() ? { comment: note.trim() } : {}),
      ...(at ? { publishAt: at } : {}),
      ...edited,
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.message ?? "That did not work. Try again.");
    toast.success(decision === "APPROVED" ? (ids.length > 1 ? `Approved all ${ids.length}` : "Approved") : "Rejected");
    setNote("");
    router.refresh();
  }

  const plannedLabel = scheduledAt ? `${dayLabel(scheduledAt, timeZone)}, ${timeLabel(scheduledAt, timeZone)}` : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-2.5">
          <h1 className="font-display text-[32px] leading-[1.05] font-bold tracking-[-0.025em] text-balance md:text-[40px]">{title}</h1>
          <div className="flex flex-wrap gap-2 text-[13px] text-[#454B53] dark:text-muted-foreground">
            {chips.map((c) => (
              <span key={c} className="inline-flex h-7 items-center rounded-lg border border-border bg-card px-2.5">
                {c}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href={`/agent/${runId}/live`}>{status === "AWAITING_APPROVAL" || !pending.length ? "Replay the council" : "Watch the council"}</Link>
          </Button>
          {canDecide && status === "AWAITING_APPROVAL" && pending.length > 0 && (
            <>
              <Button variant="outline" onClick={() => setRevising((v) => !v)}>
                <RefreshCw aria-hidden /> Revise
              </Button>
              <Button variant="signal" disabled={busy} onClick={() => void decide(pending.map((a) => a.id), "APPROVED")}>
                <Check aria-hidden /> {pending.length === 1 ? "Approve" : pending.length === 2 ? "Approve both" : `Approve all ${pending.length}`}
              </Button>
            </>
          )}
        </div>
      </header>

      {accounts.length > 1 && (
        <div role="tablist" aria-label="Accounts" className="flex flex-wrap gap-2.5">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={a.id === account.id}
              onClick={() => {
                setTab(a.id);
                setRevising(false);
              }}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left",
                a.id === account.id ? "border border-foreground bg-card shadow-[0_1px_0_var(--foreground)]" : "border border-border hover:bg-card",
              )}
            >
              <PlatformIcon platform={a.platform} className="size-7 text-[10px]" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-semibold">{a.displayName}</span>
                <span className="text-[12px] text-muted-foreground">{a.accountType}</span>
              </span>
              <span className="ml-2">
                <StatusPill decision={a.decision} hasText={Boolean(a.text)} />
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_620px] flex-col gap-4">
          <section className="overflow-hidden rounded-[14px] border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-rule px-3.5 py-2.5">
              <div role="group" aria-label="Mode" className="flex rounded-[9px] bg-[#F1F2EF] p-[3px] dark:bg-white/[0.06]">
                {(["preview", "edit"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    disabled={m === "edit" && !decidable}
                    onClick={() => setMode(m)}
                    className={cn(
                      "h-[30px] rounded-[7px] px-3 text-[13px] disabled:opacity-50",
                      mode === m ? "bg-card font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "",
                    )}
                  >
                    {m === "preview" ? "Preview" : "Edit text"}
                  </button>
                ))}
              </div>
              <span className={cn("font-mono text-[12px]", text.length > limit ? "text-danger" : "text-muted-foreground")}>
                {charCount(text)} / {limit.toLocaleString("en-US")}
              </span>
              <span className="flex-grow" />
              {decidable && text.trim() !== account.polishText.trim() && account.polishText && (
                <button
                  type="button"
                  onClick={() => setTexts((t) => ({ ...t, [account.id]: account.polishText }))}
                  className="text-[13px] text-[#3F454D] underline underline-offset-[3px] dark:text-muted-foreground"
                >
                  Restore Polish’s version
                </button>
              )}
            </div>
            <div className="bg-[#F6F7F4] p-4 md:p-6 dark:bg-white/[0.02]">
              {!account.text ? (
                <p className="text-sm text-muted-foreground">The text is still being written.</p>
              ) : mode === "edit" ? (
                <Textarea
                  value={text}
                  onChange={(e) => setTexts((t) => ({ ...t, [account.id]: e.target.value }))}
                  rows={14}
                  maxLength={65000}
                  aria-label={`Post text for ${account.displayName}`}
                  className="bg-card text-[15px] leading-relaxed"
                />
              ) : (
                <div className="mx-auto max-w-[560px]">
                  <PostPreview
                    platform={account.platform}
                    account={{ displayName: account.displayName, avatarUrl: account.avatarUrl }}
                    text={text}
                    media={account.image ? [{ id: "image", url: account.image.url, alt: account.image.alt }] : []}
                  />
                  {!account.image && account.mediaConcept && (
                    <p className="mt-3 rounded-[10px] bg-[#1B1E23] px-4 py-3 text-center text-[13px] text-[#C3C8CF]">
                      Image idea · {account.mediaConcept}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {account.performance && <PerformanceBadge {...account.performance} />}

          {(revising || mode === "edit") && decidable && (
            <section className="rounded-[14px] border border-border bg-card p-5">
              <EditTools
                runId={runId}
                accountId={account.id}
                text={text}
                savedText={saved[account.id] ?? ""}
                disabled={busy}
                onUpdated={(edited: EditedAccount) => {
                  setTexts((t) => ({ ...t, [account.id]: edited.text }));
                  setSaved((t) => ({ ...t, [account.id]: edited.text }));
                }}
              />
            </section>
          )}

          {decidable ? (
            <section className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-5">
              <h2 className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">When it goes out</h2>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-2.5">
                {(
                  [
                    {
                      key: "planned" as const,
                      title: plannedLabel ? "As planned" : account.bestWindow ? "Best window" : "Right after approval",
                      detail: plannedLabel ?? (account.bestWindow ? `${account.bestWindow} · learned from past posts` : "Goes out as soon as it is approved"),
                    },
                    { key: "pick" as const, title: "Pick a time", detail: `In ${timeZone}` },
                    { key: "now" as const, title: "Publish now", detail: "Goes out within a minute" },
                  ]
                ).map((o) => (
                  <label
                    key={o.key}
                    className={cn(
                      "flex cursor-pointer gap-2.5 rounded-[10px] px-3.5 py-3",
                      when === o.key ? "border-[1.5px] border-foreground bg-card" : "border border-border",
                    )}
                  >
                    <input type="radio" name="when" checked={when === o.key} onChange={() => setWhen(o.key)} className="mt-[3px] accent-foreground" />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[14px] font-semibold">{o.title}</span>
                      <span className="text-[12.5px] leading-snug text-muted-foreground">{o.detail}</span>
                      {o.key === "pick" && when === "pick" && (
                        <input
                          type="datetime-local"
                          value={pick}
                          onChange={(e) => setPick(e.target.value)}
                          className="mt-1.5 h-9 rounded-lg border border-input bg-card px-2 text-[13px]"
                          aria-label="Publish time"
                        />
                      )}
                    </span>
                  </label>
                ))}
              </div>
              <label htmlFor="note" className="text-[13px] font-semibold text-muted-foreground">
                Note to the council <span className="font-normal">— optional; it learns from what you say</span>
              </label>
              <textarea
                id="note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                placeholder="e.g. Good. Next time open with the penalty figure."
                className="resize-y rounded-[10px] border border-input bg-card px-3 py-2.5 text-[14px] outline-none focus:border-signal/60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="signal" size="lg" disabled={busy} onClick={() => void decide([account.id], "APPROVED")}>
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />} {when === "now" ? "Approve & publish" : "Approve & schedule"}
                </Button>
                <Button variant="outline" size="lg" onClick={() => setRevising((v) => !v)} aria-expanded={revising}>
                  <RefreshCw aria-hidden /> Ask for a revision
                </Button>
                <span className="flex-grow" />
                <Button
                  variant="outline"
                  size="lg"
                  disabled={busy}
                  onClick={() => void decide([account.id], "REJECTED")}
                  className="border-[#E8C4C4] text-danger hover:bg-danger-soft dark:border-danger/40"
                >
                  <X aria-hidden /> Reject
                </Button>
              </div>
              {text.trim() !== (saved[account.id] ?? "").trim() && <p className="text-xs text-muted-foreground">Your edit goes out with the approval.</p>}
            </section>
          ) : (
            account.decision !== "PENDING" && (
              <p className="rounded-[14px] border border-border bg-card px-5 py-4 text-[14px]">
                {account.decision === "APPROVED" ? "You approved this one." : "You rejected this one."}
                {account.decisionComment ? ` Your note: “${account.decisionComment}”` : ""}
                {account.postId && (
                  <>
                    {" "}
                    <Link href={`/posts/${account.postId}`} className="underline underline-offset-2">
                      Open the post
                    </Link>
                  </>
                )}
              </p>
            )
          )}
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 lg:max-w-[380px]">
          <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
            <div className="flex items-center gap-2.5">
              <AgentDisc stage="strategy" />
              <h2 className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">Why this angle</h2>
            </div>
            <p className="text-[14px] leading-normal">{account.angle.summary ?? "The strategist didn’t leave a note for this one."}</p>
            {account.angle.rows.length > 0 && (
              <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-2 text-[13px]">
                {account.angle.rows.map((r) => (
                  <div key={r.label} className="contents">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {account.scores.length > 0 && (
            <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
              <div className="flex items-center gap-2.5">
                <AgentDisc stage="judge" />
                <h2 className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">Blind judgement</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {account.scores.map((s) => (
                  <div key={s.label} className={cn("flex-1 rounded-[10px] p-2.5 text-center", s.winner ? "bg-foreground text-background" : "bg-[#F6F7F4] dark:bg-white/[0.04]")}>
                    <div className={cn("font-mono text-[12px]", s.winner ? "opacity-75" : "text-muted-foreground")}>
                      {s.label}
                      {s.winner ? " · winner" : ""}
                    </div>
                    <div className="font-display text-[22px] font-bold">{s.score === null ? "—" : s.score.toFixed(1)}</div>
                  </div>
                ))}
              </div>
              {account.rationale && <p className="text-[13px] leading-snug">“{account.rationale}”</p>}
              <p className="text-[12.5px] leading-snug text-muted-foreground">The judge saw text only — no model names, no cost.</p>
            </section>
          )}

          {account.checks.length > 0 && (
            <section className="rounded-[14px] border border-border bg-card px-5 pt-5 pb-2">
              <div className="flex items-center gap-2.5 pb-1.5">
                <AgentDisc stage="review" />
                <h2 className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">Checks</h2>
                <span className="ml-auto">
                  <Badge variant={checksClear === account.checks.length ? "success" : "warning"}>
                    {checksClear} of {account.checks.length} clear
                  </Badge>
                </span>
              </div>
              <ul>
                {account.checks.map((c) => (
                  <li key={c.name} className="flex items-start gap-2.5 border-t border-rule py-2">
                    {c.ok ? <Check className="mt-px size-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="mt-px size-4 shrink-0 text-warn" aria-hidden />}
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[13.5px] font-semibold">{c.name}</span>
                      <span className="text-[12.5px] text-muted-foreground">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {claims.length > 0 && (
            <section className="rounded-[14px] border border-border bg-card px-5 pt-5 pb-2">
              <div className="flex items-center gap-2.5 pb-1.5">
                <AgentDisc stage="research" />
                <h2 className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">Claims</h2>
              </div>
              <ul>
                {claims.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1.5 border-t border-rule py-2.5">
                    <div className="flex items-start justify-between gap-2.5">
                      <span className="text-[13.5px] leading-snug">{c.statement}</span>
                      <Badge variant={c.supported ? "success" : "warning"}>{c.supported ? "Supported" : "Unverified"}</Badge>
                    </div>
                    <span className="text-[12.5px] text-muted-foreground">{c.source}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function StatusPill({ decision, hasText }: { decision: string; hasText: boolean }) {
  if (decision === "APPROVED") return <Badge variant="success">Approved</Badge>;
  if (decision === "REJECTED") return <Badge variant="danger">Rejected</Badge>;
  return hasText ? <Badge variant="signal">Ready</Badge> : <Badge variant="muted">Writing</Badge>;
}

function AgentDisc({ stage }: { stage: keyof typeof AGENTS }) {
  const a = AGENTS[stage];
  return (
    <span
      aria-hidden
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full font-display text-[12px] font-bold text-white dark:text-[#111316]"
      style={{ background: a.from }}
    >
      {a.name.charAt(0)}
    </span>
  );
}
