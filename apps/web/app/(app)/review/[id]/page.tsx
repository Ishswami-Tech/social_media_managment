import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/session";
import { ApiError } from "@/lib/errors";
import { getRun, type AgentRunDetail } from "@/lib/agent/runs";
import { composeFinalText } from "@/lib/agent/apply";
import { formatCents, formatLatency } from "@/components/agent/format";
import { RunReplay, type ReplayEvent } from "@/components/agent/run-replay";
import { IN_PROGRESS_STATUSES, statusLabel } from "@/components/home/labels";
import { RefreshTimer } from "@/components/home/refresh-timer";
import { ReviewPanel, type ReviewAccount, type ReviewSource } from "@/components/review/review-panel";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Review" };

type RunAccount = AgentRunDetail["accounts"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `AgentRunAccount.strategy` is free-form JSON; we only read the one line people need. */
function readAngle(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["angle", "rationale", "hookType"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function payload(label: string, value: unknown): { label: string; json: string }[] {
  if (value === null || value === undefined) return [];
  return [{ label, json: JSON.stringify(value, null, 2) }];
}

function toReplayEvents(run: AgentRunDetail): ReplayEvent[] {
  return run.events.map((e) => ({
    id: e.id,
    step: e.step,
    status: e.status,
    provider: e.provider,
    model: e.model,
    promptKey: e.promptKey,
    promptVersion: e.promptVersion,
    costCents: e.costCents,
    latencyMs: e.latencyMs,
    error: e.error,
    createdAt: e.createdAt.toISOString(),
    payloads: [...payload("Input", e.input), ...payload("Output", e.output), ...payload("Validation", e.validation)],
  }));
}

function toReviewAccount(a: RunAccount): ReviewAccount {
  const base = a.editedText ?? a.finalText ?? "";
  return {
    id: a.id,
    platform: a.platform,
    displayName: a.socialAccount.displayName,
    text: base ? composeFinalText(base, a.finalHashtags) : "",
    why: readAngle(a.strategy),
    decision: a.decision,
    decisionComment: a.decisionComment,
    postId: a.postId,
    error: a.error,
  };
}

function DraftList({ account }: { account: RunAccount }) {
  if (account.drafts.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{account.socialAccount.displayName}</p>
      {account.drafts.map((d) => (
        <div key={d.id} className="rounded-md bg-muted/40 p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={d.id === account.winnerDraftId ? "success" : "outline"}>
              {d.label} · {d.role.toLowerCase()}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {d.provider} / {d.model}
            </span>
            {d.judgeScore !== null && (
              <span className="text-xs text-muted-foreground">score {d.judgeScore.toFixed(2)}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatCents(d.costCents)} · {formatLatency(d.latencyMs)}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap">{d.text}</p>
          {d.judgeRationale && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium">Verdict: </span>
              {d.judgeRationale}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCapability("ai:generate");
  const { id } = await params;
  let run: AgentRunDetail;
  try {
    run = await getRun(ctx, id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const isAdmin = ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.actor.isSuperAdmin === true;
  const own = run.createdById === ctx.user.id;
  const canApprove = ctx.can("content:approve") && (!own || isAdmin);
  const canDecide = canApprove && run.status === "AWAITING_APPROVAL";

  const sources: ReviewSource[] = run.claims
    .filter((c) => c.status === "SUPPORTED")
    .map((c) => ({ id: c.id, title: c.sourceTitle ?? c.sourceUrl ?? c.statement, url: c.sourceUrl }));
  const unverifiedCount = run.claims.filter((c) => c.status !== "SUPPORTED").length;
  const accounts = run.accounts.map(toReviewAccount);
  const inProgress = IN_PROGRESS_STATUSES.includes(run.status);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <RefreshTimer enabled={inProgress} />
      <PageHeader title={run.topic} description={statusLabel(run.status)} />

      {run.status === "BLOCKED" && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          We stopped to check with you. {run.blockedReason ?? "Resume when you are ready."}
        </p>
      )}
      {run.status === "FAILED" && (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Something went wrong{run.error ? `: ${run.error}` : "."} Use “Try again” below.
        </p>
      )}
      {run.status === "AWAITING_APPROVAL" && !canApprove && (
        <p className="text-sm text-muted-foreground">
          {own
            ? "You asked for this one, so someone else on your team has to approve it."
            : "Your role cannot approve posts."}
        </p>
      )}

      <ReviewPanel
        runId={run.id}
        status={run.status}
        accounts={accounts}
        sources={sources}
        unverifiedCount={unverifiedCount}
        canDecide={canDecide}
        canManage={ctx.can("content:create")}
      />

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">How this was made</summary>
        <div className="mt-4 grid gap-6">
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Steps</h3>
            <RunReplay events={toReplayEvents(run)} />
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-medium">Options we considered</h3>
            {run.accounts.every((a) => a.drafts.length === 0) ? (
              <p className="text-sm text-muted-foreground">No alternatives were written.</p>
            ) : (
              run.accounts.map((a) => <DraftList key={a.id} account={a} />)
            )}
          </section>

          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Facts and sources</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Statement</TableHead>
                  <TableHead>Checked</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.claims.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      Nothing to check yet.
                    </TableCell>
                  </TableRow>
                )}
                {run.claims.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-sm text-sm">{c.statement}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{Math.round(c.confidence * 100)}%</TableCell>
                    <TableCell className="text-sm">
                      {c.sourceUrl ? (
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                          {c.sourceTitle ?? "Source"}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{c.sourceTitle ?? "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </div>
      </details>

      <Link href="/home" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        Back to home
      </Link>
    </div>
  );
}
