import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/session";
import { ApiError } from "@/lib/errors";
import { getRun, type AgentRunDetail } from "@/lib/agent/runs";
import { monthlyBudgetStatus } from "@/lib/agent/budget";
import { formatDate } from "@/lib/utils";
import { formatCents, formatLatency } from "@/components/agent/format";
import { RunReplay, type ReplayEvent } from "@/components/agent/run-replay";
import { AgentAccountDecision, AgentRunActions } from "@/components/forms/agent-run-actions";
import { PageHeader } from "@/components/app/page-header";
import { PlatformIcon } from "@/components/app/platform-icon";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Campaign" };

type RunAccount = AgentRunDetail["accounts"][number];

interface Strategy {
  angle?: string;
  hookType?: string;
  format?: string;
  cta?: string;
  rationale?: string;
  keyPoints?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** `AgentRunAccount.strategy` is free-form JSON; read only the fields we render. */
function readStrategy(value: unknown): Strategy | null {
  if (!isRecord(value)) return null;
  const keyPoints = Array.isArray(value.keyPoints)
    ? value.keyPoints.filter((p): p is string => typeof p === "string")
    : undefined;
  const strategy: Strategy = {
    angle: readString(value, "angle"),
    hookType: readString(value, "hookType"),
    format: readString(value, "format"),
    cta: readString(value, "cta"),
    rationale: readString(value, "rationale"),
    ...(keyPoints?.length ? { keyPoints } : {}),
  };
  return Object.values(strategy).some((v) => v !== undefined) ? strategy : null;
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
    payloads: [
      ...payload("Input", e.input),
      ...payload("Output", e.output),
      ...payload("Validation", e.validation),
    ],
  }));
}

function StrategyCard({ strategy }: { strategy: Strategy }) {
  const rows: [string, string | undefined][] = [
    ["Angle", strategy.angle],
    ["Hook", strategy.hookType],
    ["Format", strategy.format],
    ["Call to action", strategy.cta],
  ];
  return (
    <div className="grid gap-1 rounded-md border p-3 text-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Strategy</p>
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <p key={label}>
            <span className="text-muted-foreground">{label}: </span>
            {value}
          </p>
        ))}
      {strategy.keyPoints?.length ? (
        <ul className="mt-1 list-inside list-disc text-muted-foreground">
          {strategy.keyPoints.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {strategy.rationale && <p className="mt-1 text-xs text-muted-foreground">{strategy.rationale}</p>}
    </div>
  );
}

function AccountCard({
  account,
  runId,
  canDecide,
}: {
  account: RunAccount;
  runId: string;
  canDecide: boolean;
}) {
  const strategy = readStrategy(account.strategy);
  const finalText = account.editedText ?? account.finalText ?? "";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlatformIcon platform={account.platform} /> {account.socialAccount.displayName}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <StatusBadge status={account.decision} />
          {account.postId && (
            <Link href={`/posts/${account.postId}`} className="underline">
              View the created post
            </Link>
          )}
          {account.error && <span className="text-destructive">{account.error}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {strategy && <StrategyCard strategy={strategy} />}
        {finalText ? (
          <div className="grid gap-1 rounded-md border p-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Recommendation</p>
            <p className="text-sm whitespace-pre-wrap">{finalText}</p>
            {account.finalHashtags.length > 0 && (
              <p className="text-sm text-muted-foreground">{account.finalHashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</p>
            )}
            {account.mediaConcept && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Media concept: </span>
                {account.mediaConcept}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recommendation yet — the council is still working.</p>
        )}
        {account.decisionComment && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Reviewer comment: </span>
            {account.decisionComment}
          </p>
        )}
        {account.drafts.length > 0 && (
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {account.drafts.length} draft(s) from the council
            </summary>
            <div className="mt-2 grid gap-2">
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
                      <span className="font-medium">Judge: </span>
                      {d.judgeRationale}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
        {canDecide && account.decision === "PENDING" && finalText && (
          <AgentAccountDecision runId={runId} accountId={account.id} finalText={finalText} />
        )}
      </CardContent>
    </Card>
  );
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCapability("ai:generate");
  const { id } = await params;
  let run: AgentRunDetail;
  try {
    run = await getRun(ctx, id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const budget = await monthlyBudgetStatus(ctx.organization.id);

  const isAdmin = ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.actor.isSuperAdmin === true;
  const ownRun = run.createdById === ctx.user.id;
  const canApprove = ctx.can("content:approve") && (!ownRun || isAdmin);
  const canDecide = canApprove && run.status === "AWAITING_APPROVAL";
  const pendingAccountIds = run.accounts.filter((a) => a.decision === "PENDING" && a.finalText).map((a) => a.id);
  const spentPercent = run.maxCents > 0 ? Math.min(100, Math.round((run.spentCents / run.maxCents) * 100)) : 0;
  const budgetPercent =
    budget.budgetCents > 0
      ? Math.min(100, Math.round(((budget.spentCents + budget.reservedCents) / budget.budgetCents) * 100))
      : 0;

  return (
    <>
      <PageHeader title={run.topic} description={run.goal}>
        <StatusBadge status={run.status} />
      </PageHeader>
      {run.blockedReason && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{run.blockedReason}</p>
      )}
      {run.error && <p className="mb-4 rounded-md border border-destructive/40 p-3 text-sm text-destructive">{run.error}</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Brief</CardTitle>
              <CardDescription>
                Created {formatDate(run.createdAt)} · {run.assurance.replaceAll("_", " ").toLowerCase()} ·{" "}
                {run.publishMode.replaceAll("_", " ").toLowerCase()}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p>
                <span className="text-muted-foreground">Goal: </span>
                {run.goal}
              </p>
              {run.audience && (
                <p>
                  <span className="text-muted-foreground">Audience: </span>
                  {run.audience}
                </p>
              )}
              {run.notes && (
                <p>
                  <span className="text-muted-foreground">Notes: </span>
                  {run.notes}
                </p>
              )}
              {run.scheduledAt && (
                <p>
                  <span className="text-muted-foreground">Scheduled for: </span>
                  {formatDate(run.scheduledAt, { dateStyle: "medium", timeStyle: "short" }, run.timezone)}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Claims ledger</CardTitle>
              <CardDescription>Every factual statement the drafts may use, with its source.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Statement</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.claims.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        No claims recorded yet.
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
            </CardContent>
          </Card>

          {run.accounts.map((a) => (
            <AccountCard key={a.id} account={a} runId={run.id} canDecide={canDecide} />
          ))}
          {run.accounts.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                This campaign has no target accounts.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Replay</CardTitle>
              <CardDescription>Every stage with its provider, prompt version, cost and latency.</CardDescription>
            </CardHeader>
            <CardContent>
              <RunReplay events={toReplayEvents(run)} />
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Spend</CardTitle>
              <CardDescription>
                {formatCents(run.spentCents)} of {formatCents(run.maxCents)} for this campaign
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Progress value={spentPercent} />
              <div className="grid gap-1 border-t pt-3 text-sm">
                <p className="font-medium">This month</p>
                <Progress value={budgetPercent} />
                <p className="text-xs text-muted-foreground">
                  {formatCents(budget.spentCents)} spent · {formatCents(budget.reservedCents)} reserved ·{" "}
                  {formatCents(budget.availableCents)} left of {formatCents(budget.budgetCents)}
                </p>
              </div>
            </CardContent>
          </Card>
          <AgentRunActions
            runId={run.id}
            status={run.status}
            canManage={ctx.can("content:create")}
            canApprove={canApprove}
            pendingAccountIds={pendingAccountIds}
          />
          {run.status === "AWAITING_APPROVAL" && !canApprove && (
            <p className="text-sm text-muted-foreground">
              {ownRun
                ? "You started this campaign, so another reviewer has to decide."
                : "You do not have permission to approve campaigns."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
