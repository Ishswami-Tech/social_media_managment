/**
 * Plain-language progress for a campaign, derived from the run status plus the
 * step events the worker writes as it goes.
 *
 * Pure and dependency-free on purpose: the server builds the first view during
 * rendering and the browser rebuilds the same view from the live stream, so the
 * two can never disagree. Nothing here reads a database, a clock or the DOM.
 *
 * Wording rule: everything in here is read by the person who asked for the
 * post, so no internal vocabulary leaks out (no run, stage key, step name or
 * account id).
 */

export const PROGRESS_STAGE_KEYS = [
  "research",
  "strategy",
  "drafting",
  "review",
  "judge",
  "adapt",
  "ready",
] as const;

export type ProgressStageKey = (typeof PROGRESS_STAGE_KEYS)[number];

export type ProgressStageState = "pending" | "active" | "done" | "failed" | "skipped";

/** One step event, trimmed to what the progress view needs. */
export interface ProgressEvent {
  id: string;
  /** Raw worker step, e.g. `writer:acc_1:A` or `checks:acc_1:A.final`. */
  step: string;
  /** STARTED | SUCCEEDED | FAILED | SKIPPED. */
  status: string;
  provider?: string | null;
  model?: string | null;
  costCents?: number;
  latencyMs?: number;
  error?: string | null;
  /** ISO timestamp. */
  at: string;
  /** Only carried for `judge.verdict`, whose output names the winning draft. */
  output?: { winner?: string } | null;
}

/** One social account taking part, as the progress view needs it. */
export interface ProgressAccount {
  runAccountId: string;
  displayName: string;
  platform: string;
  decision?: string;
  hasRecommendation?: boolean;
}

export interface ProgressStage {
  key: ProgressStageKey;
  label: string;
  state: ProgressStageState;
  /** ISO timestamps; absent until the stage has produced an event. */
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  costCents: number;
  /** Chronological, human-readable lines describing what just happened. */
  activity: string[];
}

export interface RunProgress {
  stages: ProgressStage[];
  overall: { label: string; percent: number };
}

/** Extra facts the events cannot carry, supplied by whoever loaded the run. */
export interface ProgressExtras {
  /** Number of recorded claims, so "Recording N facts" can be truthful. */
  claimCount?: number;
}

// ---------------------------------------------------------------------------
// Display names
// ---------------------------------------------------------------------------

const PLATFORM_NAMES: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  THREADS: "Threads",
  X: "X",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  PINTEREST: "Pinterest",
};

const PROVIDER_NAMES: Record<string, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic",
  GOOGLE: "Google",
};

function titleCase(value: string): string {
  const lower = value.replaceAll("_", " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? titleCase(platform);
}

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? titleCase(provider);
}

/** Compact, spoken-aloud duration: 850 → "0.9 s", 4120 → "4.1 s", 151000 → "2m 31s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0.0 s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** Joins names the way a person would: "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Step parsing
// ---------------------------------------------------------------------------

interface ParsedStep {
  /** Leading segment, e.g. `writer`, `checks`, `judge.verdict`. */
  head: string;
  runAccountId?: string;
  /** Draft label, e.g. `A`. */
  label?: string;
  /** Suffix after the label, e.g. `final` or `revision`. */
  suffix?: string;
}

function parseStep(step: string): ParsedStep {
  const [head = "", runAccountId, detail] = step.split(":");
  if (!detail) return { head, runAccountId };
  const [label, suffix] = detail.split(".");
  return { head, runAccountId, label, suffix };
}

/** Which stage an event belongs to, or null for bookkeeping steps nobody reads. */
export function stageOfStep(step: string): ProgressStageKey | null {
  const parsed = parseStep(step);
  // The final check belongs with the adaptation it validates, not with review.
  if (parsed.head === "checks" && parsed.suffix === "final") return "adapt";
  switch (parsed.head) {
    case "research":
    case "claims":
      return "research";
    case "strategy":
      return "strategy";
    case "writer":
      return "drafting";
    case "checks":
    case "revision":
    case "cross-review":
    case "draft-dropped":
    case "review":
    case "review.notes":
      return "review";
    case "judge":
    case "judge.verdict":
      return "judge";
    case "synthesis":
    case "adapt":
    case "media":
      return "adapt";
    case "notify":
    case "decision":
    case "complete":
      return "ready";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Status → position
// ---------------------------------------------------------------------------

const STATUS_STAGE: Record<string, ProgressStageKey> = {
  QUEUED: "research",
  RESEARCHING: "research",
  STRATEGIZING: "strategy",
  DRAFTING: "drafting",
  REVIEWING: "review",
  JUDGING: "judge",
  ADAPTING: "adapt",
  AWAITING_APPROVAL: "ready",
  APPROVED: "ready",
  PUBLISHING: "ready",
  COMPLETED: "ready",
};

/** Statuses where the work has stopped and the stepper should stop animating. */
const HALTED = new Set(["FAILED", "BLOCKED", "CANCELLED", "PAUSED"]);

/** Statuses where there is something for the person to look at. */
const READY = new Set(["AWAITING_APPROVAL", "APPROVED", "COMPLETED"]);

const OVERALL_LABELS: Record<string, string> = {
  FAILED: "Something went wrong",
  BLOCKED: "Needs your attention",
  CANCELLED: "Stopped",
  PAUSED: "Paused",
  APPROVED: "Getting ready to publish…",
  PUBLISHING: "Publishing…",
  COMPLETED: "Done",
  AWAITING_APPROVAL: "Ready for your review",
};

function indexOfStage(key: ProgressStageKey): number {
  return PROGRESS_STAGE_KEYS.indexOf(key);
}

// ---------------------------------------------------------------------------
// Activity lines
// ---------------------------------------------------------------------------

interface Ctx {
  accounts: readonly ProgressAccount[];
  /** Draft labels that survived, per account, used for "Scoring 3 drafts…". */
  candidates: Map<string, Set<string>>;
  many: boolean;
  claimCount?: number;
}

function nameOf(ctx: Ctx, runAccountId: string | undefined): string {
  if (!runAccountId) return "your account";
  return ctx.accounts.find((a) => a.runAccountId === runAccountId)?.displayName ?? "your account";
}

/** " for Acme" — only when more than one account is in play, to avoid noise. */
function forAccount(ctx: Ctx, runAccountId: string | undefined): string {
  return ctx.many ? ` for ${nameOf(ctx, runAccountId)}` : "";
}

function via(event: ProgressEvent): string {
  return event.provider ? ` via ${providerName(event.provider)}` : "";
}

function took(event: ProgressEvent): string {
  return event.latencyMs && event.latencyMs > 0 ? ` · ${formatDuration(event.latencyMs)}` : "";
}

function researchLine(event: ProgressEvent, ctx: Ctx): string | null {
  const { head } = parseStep(event.step);
  if (head === "research") {
    if (event.status === "STARTED") return "Reading sources…";
    if (event.status === "SUCCEEDED") return `Sources read${took(event)}`;
    if (event.status === "FAILED") return `Could not finish reading: ${event.error ?? "unknown reason"}`;
    return null;
  }
  if (event.status === "STARTED") return "Picking out the facts…";
  if (event.status === "SUCCEEDED")
    return ctx.claimCount === undefined
      ? "Facts recorded"
      : `Recording ${ctx.claimCount} ${ctx.claimCount === 1 ? "fact" : "facts"}`;
  if (event.status === "FAILED") return `Could not record the facts: ${event.error ?? "unknown reason"}`;
  return null;
}

function strategyLine(event: ProgressEvent, ctx: Ctx): string | null {
  const name = nameOf(ctx, parseStep(event.step).runAccountId);
  if (event.status === "STARTED") return `Choosing an angle for ${name}…`;
  if (event.status === "SUCCEEDED") return `Angle chosen for ${name}`;
  if (event.status === "FAILED" || event.status === "SKIPPED") return `No angle for ${name}: ${event.error ?? "skipped"}`;
  return null;
}

function draftingLine(event: ProgressEvent, ctx: Ctx): string | null {
  const { runAccountId, label } = parseStep(event.step);
  if (!label) {
    // Account-level event: no writer produced anything usable.
    return event.status === "SKIPPED" ? `No draft worked${forAccount(ctx, runAccountId)}` : null;
  }
  const who = `Writer ${label}`;
  if (event.status === "STARTED") return `${who} drafting${forAccount(ctx, runAccountId)}${via(event)}…`;
  if (event.status === "SUCCEEDED") return `${who} done${took(event)}`;
  if (event.status === "FAILED" || event.status === "SKIPPED") return `${who} did not finish`;
  return null;
}

function reviewLine(event: ProgressEvent, ctx: Ctx): string | null {
  const { head, runAccountId, label, suffix } = parseStep(event.step);
  const draft = label ? `Draft ${label}` : "The draft";
  switch (head) {
    case "checks":
      if (suffix === "revision")
        return event.status === "SUCCEEDED" ? `${draft} passed after the fix` : `${draft} still has problems`;
      if (event.status === "SUCCEEDED") return `${draft} passed the checks`;
      if (event.status === "FAILED") return `${draft} needs a fix`;
      return null;
    case "revision":
      if (event.status === "STARTED") return `Fixing ${draft.toLowerCase()}…`;
      if (event.status === "SUCCEEDED") return `${draft} fixed`;
      if (event.status === "SKIPPED" || event.status === "FAILED") return `${draft} could not be fixed`;
      return null;
    case "cross-review":
      if (event.status === "STARTED") return `Second opinion on ${draft.toLowerCase()}…`;
      if (event.status === "SUCCEEDED") return `Second opinion on ${draft.toLowerCase()} done`;
      return null;
    case "draft-dropped":
      return `${draft} dropped: ${event.error ?? "it did not pass the checks"}`;
    case "review":
      return event.status === "SKIPPED" ? `Nothing passed the checks${forAccount(ctx, runAccountId)}` : null;
    default:
      return null;
  }
}

function judgeLine(event: ProgressEvent, ctx: Ctx): string | null {
  const { head, runAccountId } = parseStep(event.step);
  if (head === "judge.verdict") {
    const winner = event.output?.winner;
    return winner ? `Winner: draft ${winner}` : null;
  }
  if (event.status === "STARTED") {
    const count = runAccountId ? (ctx.candidates.get(runAccountId)?.size ?? 0) : 0;
    return count > 0 ? `Scoring ${count} ${count === 1 ? "draft" : "drafts"}…` : "Scoring the drafts…";
  }
  if (event.status === "SUCCEEDED") return `Scored${took(event)}`;
  if (event.status === "SKIPPED" || event.status === "FAILED")
    return `Nothing to judge${forAccount(ctx, runAccountId)}`;
  return null;
}

function adaptLine(event: ProgressEvent, ctx: Ctx): string | null {
  const { head, runAccountId, label, suffix } = parseStep(event.step);
  const where = runAccountId
    ? platformName(ctx.accounts.find((a) => a.runAccountId === runAccountId)?.platform ?? "")
    : "";
  const target = where ? ` for ${where}` : "";
  if (head === "checks" && suffix === "final")
    return event.status === "SUCCEEDED" ? "Final check passed" : "Final check found a problem";
  if (head === "synthesis") {
    if (event.status === "STARTED") return "Taking the best of each draft…";
    if (event.status === "SUCCEEDED") return `Best bits combined${took(event)}`;
    return null;
  }
  if (head === "media") {
    if (event.status === "STARTED") return `Creating an image${target}${via(event)}…`;
    if (event.status === "SUCCEEDED") return `Image ready${target}${took(event)}`;
    if (event.status === "FAILED") return `Could not create an image${target}: ${event.error ?? "unknown reason"}`;
    return null;
  }
  if (!label) return event.status === "SKIPPED" ? `Nothing to shape${forAccount(ctx, runAccountId)}` : null;
  if (event.status === "STARTED") return `Shaping it${target}…`;
  if (event.status === "SUCCEEDED") return `Shaped${target}${took(event)}`;
  if (event.status === "FAILED") return `Could not shape it${target}`;
  return null;
}

function readyLine(event: ProgressEvent): string | null {
  const { head } = parseStep(event.step);
  if (head === "notify")
    return event.status === "SUCCEEDED" ? "We emailed the people who can approve it" : null;
  if (head === "decision") return "Your decision was recorded";
  if (head === "complete") return "All wrapped up";
  return null;
}

function lineFor(key: ProgressStageKey, event: ProgressEvent, ctx: Ctx): string | null {
  switch (key) {
    case "research":
      return researchLine(event, ctx);
    case "strategy":
      return strategyLine(event, ctx);
    case "drafting":
      return draftingLine(event, ctx);
    case "review":
      return reviewLine(event, ctx);
    case "judge":
      return judgeLine(event, ctx);
    case "adapt":
      return adaptLine(event, ctx);
    case "ready":
      return readyLine(event);
  }
}

// ---------------------------------------------------------------------------
// Stage labels
// ---------------------------------------------------------------------------

function adaptLabel(accounts: readonly ProgressAccount[]): string {
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  if (platforms.length === 0) return "Adapting for your platforms";
  if (platforms.length > 2) return "Adapting for each platform";
  return `Adapting for ${listNames(platforms.map(platformName))}`;
}

function stageLabel(key: ProgressStageKey, accounts: readonly ProgressAccount[]): string {
  switch (key) {
    case "research":
      return "Researching";
    case "strategy":
      return "Planning the angle";
    case "drafting":
      return "Writing drafts";
    case "review":
      return "Checking facts and rules";
    case "judge":
      return "Blind judge";
    case "adapt":
      return adaptLabel(accounts);
    case "ready":
      return "Ready for your review";
  }
}

// ---------------------------------------------------------------------------
// buildProgress
// ---------------------------------------------------------------------------

/** Draft labels per account that are still in the running when the judge starts. */
function countCandidates(events: readonly ProgressEvent[]): Map<string, Set<string>> {
  const written = new Map<string, Set<string>>();
  for (const event of events) {
    const { head, runAccountId, label } = parseStep(event.step);
    if (!runAccountId || !label) continue;
    if (head === "writer" && event.status === "SUCCEEDED") {
      const set = written.get(runAccountId) ?? new Set<string>();
      set.add(label);
      written.set(runAccountId, set);
    }
    if (head === "draft-dropped") written.get(runAccountId)?.delete(label);
  }
  return written;
}

function byTime(a: ProgressEvent, b: ProgressEvent): number {
  return a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at);
}

/**
 * Builds the seven-stage view.
 *
 * `status` is the run status; `events` may arrive in any order and may be a
 * suffix of the full history (the stream sends the most recent ones).
 */
/**
 * A retry starts the pipeline over, so stages and durations are computed from
 * the events after the most recent `retry` marker only.
 */
export function latestAttempt(ordered: readonly ProgressEvent[]): ProgressEvent[] {
  const last = ordered.reduce((found, e, i) => (e.step === "retry" ? i : found), -1);
  return last >= 0 ? ordered.slice(last + 1) : [...ordered];
}

export function buildProgress(
  status: string,
  events: readonly ProgressEvent[],
  accounts: readonly ProgressAccount[],
  extras: ProgressExtras = {},
): RunProgress {
  const ordered = latestAttempt([...events].sort(byTime));
  const ctx: Ctx = {
    accounts,
    candidates: countCandidates(ordered),
    many: accounts.length > 1,
    claimCount: extras.claimCount,
  };

  const buckets = new Map<ProgressStageKey, ProgressEvent[]>();
  for (const event of ordered) {
    const key = stageOfStep(event.step);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(event);
    else buckets.set(key, [event]);
  }

  // Where the run currently is. When it halted we fall back to the furthest
  // stage that actually produced something, so a failure points at the culprit.
  const furthest = PROGRESS_STAGE_KEYS.reduce<ProgressStageKey>(
    (acc, key) => (buckets.has(key) ? key : acc),
    "research",
  );
  const positionKey = HALTED.has(status) ? furthest : (STATUS_STAGE[status] ?? furthest);
  const position = indexOfStage(positionKey);
  const ready = READY.has(status);

  const stages = PROGRESS_STAGE_KEYS.map<ProgressStage>((key) => {
    const index = indexOfStage(key);
    const own = buckets.get(key) ?? [];
    const costCents = own.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
    const activity: string[] = [];
    for (const event of own) {
      const line = lineFor(key, event, ctx);
      if (line && activity[activity.length - 1] !== line) activity.push(line);
    }

    let state: ProgressStageState;
    if (index < position) state = own.length > 0 ? "done" : "skipped";
    else if (index > position) state = "pending";
    else if (status === "FAILED" || status === "BLOCKED" || status === "CANCELLED") state = "failed";
    else if (key === "ready") state = ready ? "done" : "active";
    else state = "active";

    const first = own[0];
    const last = own[own.length - 1];
    const settled = state === "done" || state === "failed";
    const startedAt = first?.at;
    const finishedAt = settled ? last?.at : undefined;
    const durationMs =
      startedAt && finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : undefined;

    return {
      key,
      label: stageLabel(key, accounts),
      state,
      ...(startedAt ? { startedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      costCents,
      activity,
    };
  });

  const completed = stages.filter((s) => s.state === "done" || s.state === "skipped").length;
  const active = stages.find((s) => s.state === "active");
  const label =
    OVERALL_LABELS[status] ?? (active ? `${active.label}…` : stageLabel(positionKey, accounts));

  return {
    stages,
    overall: { label, percent: Math.round((completed / PROGRESS_STAGE_KEYS.length) * 100) },
  };
}

// ---------------------------------------------------------------------------
// Finished-run one-liner
// ---------------------------------------------------------------------------

export interface RunSummaryParts {
  sourceCount: number;
  draftCount: number;
  judged: boolean;
  adapted: boolean;
  durationMs: number;
  spentCents: number;
}

/**
 * The line shown above a finished recommendation, e.g.
 * "Researched 5 sources · 3 drafts · judged · adapted in 2m 31s for $0.14".
 */
export function buildSummaryLine(parts: RunSummaryParts): string {
  const bits = [
    `Researched ${parts.sourceCount} ${parts.sourceCount === 1 ? "source" : "sources"}`,
    `${parts.draftCount} ${parts.draftCount === 1 ? "draft" : "drafts"}`,
  ];
  if (parts.judged) bits.push("judged");
  if (parts.adapted) bits.push("adapted");
  const tail =
    parts.durationMs > 0 ? ` in ${formatDuration(parts.durationMs)}` : "";
  const cost = parts.spentCents > 0 ? ` for $${(parts.spentCents / 100).toFixed(2)}` : "";
  return `${bits.join(" · ")}${tail}${cost}`;
}
