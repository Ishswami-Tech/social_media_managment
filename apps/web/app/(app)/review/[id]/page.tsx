import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/session";
import { ApiError } from "@/lib/errors";
import { getRun, type AgentRunDetail } from "@/lib/agent/runs";
import { composeFinalText } from "@/lib/agent/apply";
import { loadRecommendationImages, type RecommendationImage } from "@/lib/agent/media";
import { performanceFor } from "@/lib/agent/performance";
import { formatCents, formatLatency } from "@/components/agent/format";
import { LiveProgress } from "@/components/agent/live-progress";
import { RunReplay, type ReplayEvent } from "@/components/agent/run-replay";
import { buildSummaryLine, detailToRunInitial } from "@/lib/agent/progress";
import { IN_PROGRESS_STATUSES, isProducing, isReady, showsLiveFlow, statusLabel } from "@/components/home/labels";
import { RefreshTimer } from "@/components/home/refresh-timer";
import { ReviewPanel, ReviewWorkspace, type ReviewAccount, type ReviewSource, type WorkspaceAccount, type WorkspaceCheck } from "@/components/review/review-panel";
import { prisma } from "@/lib/db";
import { AGENTS } from "@/components/agent/agents";
import { buildProgress, formatDuration, platformName } from "@platform/agent-council/progress";
import { ChevronRight } from "lucide-react";
import { UseDraftButton } from "@/components/agent/use-draft-button";
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

function toReviewAccount(a: RunAccount, images: ReadonlyMap<string, RecommendationImage>): ReviewAccount {
  const base = a.editedText ?? a.finalText ?? "";
  const imageId = a.mediaAssetIds.find((id) => images.has(id));
  return {
    id: a.id,
    platform: a.platform,
    displayName: a.socialAccount.displayName,
    avatarUrl: a.socialAccount.avatarUrl,
    text: base ? composeFinalText(base, a.finalHashtags) : "",
    why: readAngle(a.strategy),
    image: imageId ? (images.get(imageId) ?? null) : null,
    performance: performanceFor(a),
    decision: a.decision,
    decisionComment: a.decisionComment,
    postId: a.postId,
    error: a.error,
  };
}

/** The newest writer/revision draft per label: what "use instead" may pick. */
function latestByLabel(drafts: RunAccount["drafts"]): Set<string> {
  const latest = new Map<string, string>();
  for (const d of drafts) if (d.role === "WRITER" || d.role === "REVISION") latest.set(d.label, d.id);
  return new Set(latest.values());
}

function DraftList({ account, runId, canChoose }: { account: RunAccount; runId: string; canChoose: boolean }) {
  if (account.drafts.length === 0) return null;
  const choosable = latestByLabel(account.drafts);
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
          {canChoose && d.id !== account.winnerDraftId && choosable.has(d.id) && (
            <div className="mt-2">
              <UseDraftButton runId={runId} accountId={account.id} draftId={d.id} label={d.label} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The one line that replaces the stepper once there is something to read. */
function summaryOf(run: AgentRunDetail): string {
  const sources = new Set(
    run.claims.filter((c) => c.status === "SUPPORTED").map((c) => c.sourceUrl ?? c.sourceTitle ?? c.id),
  );
  const drafts = run.accounts.flatMap((a) => a.drafts);
  const finishedAt = run.completedAt ?? run.updatedAt;
  const startedAt = run.startedAt ?? run.createdAt;
  return buildSummaryLine({
    sourceCount: sources.size,
    draftCount: drafts.filter((d) => d.role === "WRITER").length,
    judged: drafts.some((d) => d.judgeScore !== null),
    adapted: drafts.some((d) => d.role === "ADAPTATION"),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    spentCents: run.spentCents,
  });
}

const MAX_CHARS: Record<string, number> = {
  LINKEDIN: 3000,
  FACEBOOK: 63206,
  INSTAGRAM: 2200,
  THREADS: 500,
  X: 280,
  TIKTOK: 2200,
  YOUTUBE: 5000,
  PINTEREST: 500,
};

/** The nine deterministic checks, in the order people read them, with the issue codes each one owns. */
const CHECKS: { name: string; codes: string[]; clear: string }[] = [
  { name: "Length", codes: ["length", "x_length", "empty"], clear: "Inside the platform limit" },
  { name: "Links", codes: ["url_scheme", "url_unknown"], clear: "Every link is one the research found" },
  { name: "Personal data", codes: ["pii_email", "pii_phone"], clear: "None found" },
  { name: "Never-say list", codes: ["banned_phrase"], clear: "Clear" },
  { name: "Off-limits topics", codes: ["forbidden_topic"], clear: "Clear" },
  { name: "Hashtags", codes: ["hashtags_limit", "hashtags_unsupported"], clear: "Inside this platform’s range" },
  { name: "Duplicates", codes: ["duplicate"], clear: "Nothing similar posted recently" },
  { name: "Claims", codes: ["unsupported_claim"], clear: "Every fact has a source" },
  { name: "Platform rules", codes: ["media_required"], clear: "Fits the platform" },
];

function readChecks(value: unknown): WorkspaceCheck[] {
  if (!isRecord(value) || !Array.isArray(value.issues)) return [];
  const issues = value.issues.filter(isRecord) as { code?: unknown; message?: unknown; severity?: unknown }[];
  return CHECKS.map((c) => {
    const mine = issues.filter((i) => typeof i.code === "string" && c.codes.includes(i.code));
    return {
      name: c.name,
      ok: mine.every((i) => i.severity !== "error"),
      detail: mine.length ? mine.map((i) => String(i.message ?? i.code)).join(" · ") : c.clear,
    };
  });
}

const ANGLE_ROWS: [string, string][] = [
  ["hookType", "Hook"],
  ["hook", "Hook"],
  ["format", "Format"],
  ["cta", "Ask"],
  ["callToAction", "Ask"],
  ["audience", "For"],
];

function readStrategy(value: unknown): { summary: string | null; rows: { label: string; value: string }[] } {
  if (!isRecord(value)) return { summary: null, rows: [] };
  const summary = readAngle(value);
  const rows: { label: string; value: string }[] = [];
  for (const [key, label] of ANGLE_ROWS) {
    const v = value[key];
    if (typeof v === "string" && v.trim() && v.trim() !== summary && !rows.some((r) => r.label === label))
      rows.push({ label, value: v.trim().replace(/[-_]/g, " ") });
  }
  return { summary, rows };
}

function bestWindow(profile: unknown): string | null {
  if (!isRecord(profile) || !isRecord(profile.performance)) return null;
  const w = profile.performance.bestPostingWindows;
  return Array.isArray(w) && typeof w[0] === "string" ? w[0] : null;
}

const ACCOUNT_TYPE: Record<string, string> = {
  PERSONAL: "Profile",
  ORGANIZATION: "Company page",
  PAGE: "Page",
  BUSINESS: "Business account",
  CREATOR: "Creator account",
};

function toWorkspaceAccount(a: RunAccount, images: ReadonlyMap<string, RecommendationImage>): WorkspaceAccount {
  const base = toReviewAccount(a, images);
  const writers = a.drafts.filter((d) => d.role === "WRITER");
  const latest = new Map<string, (typeof writers)[number]>();
  for (const d of writers) latest.set(d.label, d);
  const winner = a.drafts.find((d) => d.id === a.winnerDraftId);
  const finalDraft = [...a.drafts].reverse().find((d) => d.role === "ADAPTATION") ?? winner;
  return {
    ...base,
    polishText: a.finalText ? composeFinalText(a.finalText, a.finalHashtags) : "",
    accountType: `${platformName(a.platform)} ${ACCOUNT_TYPE[a.socialAccount.accountType ?? ""]?.toLowerCase() ?? "account"}`,
    angle: readStrategy(a.strategy),
    scores: [...latest.values()].map((d) => ({
      label: d.label,
      score: d.judgeScore === null ? null : Math.round((d.judgeScore / 6) * 10) / 10,
      winner: d.label === winner?.label,
    })),
    rationale: winner?.judgeRationale ?? null,
    checks: readChecks(finalDraft?.checks),
    bestWindow: bestWindow(a.socialAccount.profile),
    mediaConcept: a.mediaConcept,
  };
}

function ago(from: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - from.getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCapability(["ai:generate", "content:approve"]);
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
  const images = await loadRecommendationImages(
    ctx.organization.id,
    run.accounts.flatMap((a) => a.mediaAssetIds),
  ).catch(() => new Map<string, RecommendationImage>());
  const accounts = run.accounts.map((a) => toReviewAccount(a, images));
  const inProgress = IN_PROGRESS_STATUSES.includes(run.status);
  // While the AI is still producing there is nothing to read, so the live flow
  // stands in for the recommendation and swaps itself out when it is ready.
  const live = showsLiveFlow(run.status);
  const producing = isProducing(run.status);

  const progress = buildProgress(run.status, detailToRunInitial(run).events, detailToRunInitial(run).accounts, { claimCount: run.claims.length });
  const settings = await prisma.organizationSettings.findUnique({ where: { organizationId: ctx.organization.id }, select: { timezone: true } });
  const tz = settings?.timezone ?? "UTC";
  const workspaceAccounts = run.accounts.map((a) => toWorkspaceAccount(a, images));
  const failover = run.events.some((e) => e.step.startsWith("writer") && e.status === "FAILED");
  const startedAt = run.startedAt ?? run.createdAt;
  const finishedAt = run.completedAt ?? run.updatedAt;
  const chips = [
    run.goal ? `Goal: ${run.goal}` : null,
    run.audience ? `Audience: ${run.audience}` : null,
    run.assurance === "HIGH_ASSURANCE" ? "High assurance" : "Judge only",
    `$${(run.spentCents / 100).toFixed(2)} spent`,
    run.status === "AWAITING_APPROVAL" ? `Ready ${ago(run.updatedAt)}` : statusLabel(run.status),
  ].filter((c): c is string => c !== null);

  return (
    <div className="flex flex-col gap-8">
      <RefreshTimer enabled={inProgress} />
      <nav aria-label="Breadcrumb" className="-mb-4 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Link href="/home" className="underline underline-offset-2 hover:text-foreground">
          Today
        </Link>
        <ChevronRight className="size-3.5" aria-hidden />
        <span>Review</span>
      </nav>

      {run.status === "BLOCKED" && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-[14px] text-warn">We stopped to check with you. {run.blockedReason ?? "Resume when you are ready."}</p>
      )}
      {run.status === "FAILED" && (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-[14px] text-danger">Something went wrong{run.error ? `: ${run.error}` : "."} Use “Try again” below.</p>
      )}
      {run.status === "AWAITING_APPROVAL" && !canApprove && (
        <p className="rounded-lg bg-muted px-4 py-3 text-[14px] text-muted-foreground">
          {own ? "You asked for this one, so someone else on your team has to approve it." : "Your role cannot approve posts."}
        </p>
      )}

      {producing ? (
        <>
          <PageHeader title={run.topic} eyebrow="Being written">
            <Button variant="outline" asChild>
              <Link href={`/agent/${run.id}/live`}>Watch the council live</Link>
            </Button>
          </PageHeader>
          {live && <LiveProgress runId={run.id} initial={detailToRunInitial(run)} variant="mission" />}
          <ReviewPanel
            runId={run.id}
            status={run.status}
            accounts={accounts}
            sources={sources}
            unverifiedCount={unverifiedCount}
            canDecide={false}
            canManage={ctx.can("content:create")}
            controlsOnly
          />
        </>
      ) : (
        <ReviewWorkspace
          runId={run.id}
          status={run.status}
          accounts={workspaceAccounts}
          canDecide={canDecide}
          scheduledAt={run.scheduledAt?.toISOString() ?? null}
          timeZone={tz}
          maxChars={MAX_CHARS}
          title={run.topic}
          chips={chips}
          claims={run.claims.map((c) => ({
            id: c.id,
            statement: c.statement,
            supported: c.status === "SUPPORTED",
            source: c.sourceTitle ?? (c.status === "SUPPORTED" ? "Source recorded" : "No source found — kept out of the final text"),
          }))}
        />
      )}

      {!producing && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-display text-[20px] leading-tight font-bold tracking-[-0.01em]">How the council got here</h2>
            <span className="text-[13px] text-muted-foreground">
              {formatDuration(Math.max(0, finishedAt.getTime() - startedAt.getTime()))} · ${(run.spentCents / 100).toFixed(2)} of ${(run.maxCents / 100).toFixed(2)}
              {failover ? " · a provider was busy, so a writer moved to another model" : ""}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2.5">
            {progress.stages
              .filter((st) => st.key !== "ready")
              .map((st) => (
                <div key={st.key} className="flex min-w-0 items-center gap-2.5 rounded-[10px] bg-[#F6F7F4] p-3 dark:bg-white/[0.04]">
                  <span
                    className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold text-white dark:text-[#111316]"
                    style={{ background: AGENTS[st.key].from }}
                  >
                    {AGENTS[st.key].name.charAt(0)}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-semibold">{st.key === "drafting" ? "Quill A · B · C" : AGENTS[st.key].name}</span>
                    <span className="truncate text-[12px] text-muted-foreground">{st.activity.at(-1) ?? st.label}</span>
                    <span className="font-mono text-[11.5px] text-muted-foreground">
                      {st.durationMs ? formatDuration(st.durationMs) : "—"} · ${(st.costCents / 100).toFixed(2)}
                    </span>
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      <details className="rounded-[14px] border border-border bg-card p-5">
        <summary className="cursor-pointer font-display text-[16px] font-semibold">Full record — every step, draft and source</summary>
        <div className="mt-4 grid gap-6">
          {isReady(run.status) && <p className="text-xs text-muted-foreground">{summaryOf(run)}</p>}
          <section className="grid gap-2">
            <h3 className="text-[13px] font-medium tracking-wide text-muted-foreground uppercase">Steps</h3>
            <RunReplay events={toReplayEvents(run)} />
          </section>
          <section className="grid gap-3">
            <h3 className="text-[13px] font-medium tracking-wide text-muted-foreground uppercase">Options we considered</h3>
            {run.accounts.every((a) => a.drafts.length === 0) ? (
              <p className="text-sm text-muted-foreground">No alternatives were written.</p>
            ) : (
              run.accounts.map((a) => (
                <DraftList key={a.id} account={a} runId={run.id} canChoose={canDecide && run.status === "AWAITING_APPROVAL" && a.decision === "PENDING"} />
              ))
            )}
          </section>
          <section className="grid gap-2">
            <h3 className="text-[13px] font-medium tracking-wide text-muted-foreground uppercase">Facts and sources</h3>
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
    </div>
  );
}
