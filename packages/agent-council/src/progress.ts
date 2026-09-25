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

/** What each writer is asked to lean into; shown next to the writer and sent in its prompt. */
/**
 * A council is three seats that look at the same question differently, not
 * three copies of one prompt. The name is what the board shows; the brief is
 * appended to that seat's instructions.
 */
export const COUNCIL_PERSPECTIVES: Partial<Record<ProgressStageKey, { name: string; brief: string }[]>> = {
  research: [
    { name: "Evidence", brief: "Primary evidence first: numbers, studies, first-hand reports and official sources, each with a date. Prefer specifics over summaries." },
    { name: "Counterpoint", brief: "The other side: critiques, failure stories, limits and the objections a sceptical reader would raise. Record them as caveats and as claims of their own." },
    { name: "Practice", brief: "Practical detail: worked examples, case studies, step-by-step methods and what practitioners actually do, with the numbers they report." },
  ],
  strategy: [
    { name: "Story", brief: "Favour an angle that opens on a concrete human moment or scene and lets the lesson follow." },
    { name: "Evidence", brief: "Favour an angle that opens on the strongest number or finding, contrarian where the facts allow it." },
    { name: "Practical", brief: "Favour an angle the reader can act on today: steps, a checklist, a method or a tool." },
  ],
  review: [
    { name: "Facts", brief: "Read for facts: every number, name, cause and effect must be backed by an allowed claim. Flag anything unsupported, implied or overstated." },
    { name: "Platform", brief: "Read as the platform: the first line, length, paragraphing, hashtags, native conventions, and anything that reads like an advert or AI filler." },
    { name: "Reader", brief: "Read as the audience: would they stop, trust and act? Flag jargon, a missing 'so what', a weak or missing ask." },
  ],
  judge: [
    { name: "Credibility", brief: "Weigh goal fit, claim discipline and brand voice most heavily; a post that cannot be trusted cannot win." },
    { name: "Craft", brief: "Weigh hook strength, clarity and platform fit most heavily; the first line and the reading rhythm decide." },
    { name: "Audience", brief: "Weigh what the reader takes away and whether they would act; score the 'so what' and the call to action hardest." },
  ],
};

export const WRITER_LANES: Record<string, { name: string; brief: string }> = {
  A: {
    name: "Story",
    brief: "Lead with a concrete moment or scene from the brief or the story bank, then draw the lesson. Prefer first person where the account is a person.",
  },
  B: {
    name: "Evidence",
    brief: "Lead with the strongest number or fact from the allowed claims, then explain what it changes. Short declarative sentences, no anecdote opener.",
  },
  C: {
    name: "Contrarian",
    brief: "Open by challenging a common belief the audience holds, then make the case. End with a question that invites disagreement.",
  },
};

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
  /**
   * Carried for `judge.verdict` (winner and scores), `skills` (chosen playbooks),
   * `review` (verdict) and `writer` / `revision` / `synthesis` / `adapt` (a preview of the text).
   */
  output?: {
    winner?: string;
    scores?: { label: string; score: number; rationale?: string }[];
    skills?: string[];
    verdict?: string;
    issues?: string[];
    fixed?: boolean;
    draft?: string;
    /** Research step: the brief was remembered from a run on this date instead of researched again. */
    reusedFrom?: string;
    facts?: number;
  } | null;
}

const DRAFT_PREVIEW_CHARS = 700;
const VERDICT_STEP = "judge.verdict";

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;

/** A model call's stored output is the JSON it returned (possibly truncated); the post text inside it is the preview. */
function draftPreview(output: unknown): string | undefined {
  if (typeof output !== "string") return undefined;
  const match = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(output);
  if (!match) return undefined;
  try {
    return (JSON.parse(`"${match[1]}"`) as string).slice(0, DRAFT_PREVIEW_CHARS);
  } catch {
    return undefined;
  }
}

/**
 * Only the outputs the progress views read travel to the browser: the judge's
 * winner and scores, the chosen playbook names, a platform review's verdict and
 * a preview of the text a writing step produced. Pure, so the server (SSR and
 * the stream) and the browser (polling fallback) parse events identically.
 */
export function progressOutput(step: string, output: unknown): ProgressEvent["output"] {
  const head = step.split(":")[0] ?? "";
  if (head === "writer" || head === "revision" || head === "synthesis" || head === "adapt") {
    const draft = draftPreview(output);
    return draft ? { draft } : undefined;
  }
  if (typeof output !== "object" || output === null || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  if (step === VERDICT_STEP) {
    const scores = Array.isArray(record.scores)
      ? record.scores.flatMap((s) => {
          if (typeof s !== "object" || s === null) return [];
          const { label, score, rationale } = s as { label?: unknown; score?: unknown; rationale?: unknown };
          return typeof label === "string" && typeof score === "number"
            ? [{ label, score, ...(typeof rationale === "string" ? { rationale } : {}) }]
            : [];
        })
      : [];
    return typeof record.winner === "string" ? { winner: record.winner, scores } : undefined;
  }
  if (step === "skills") return { skills: strings(record.skills) ?? [] };
  if (step.startsWith("review:") && typeof record.verdict === "string")
    return { verdict: record.verdict, issues: strings(record.issues) ?? [], fixed: record.fixed === true };
  return undefined;
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
  META: "Meta",
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
    case "skills":
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

const MAX_REASON_CHARS = 140;

/**
 * Provider errors arrive as paragraphs with links and metrics; the person only
 * needs the first sentence. Keeps everything short of a URL or a line break.
 */
export function shortReason(error: string | null | undefined): string {
  if (!error) return "unknown reason";
  const firstLine = error.split(/\r?\n/)[0] ?? error;
  const beforeLink = firstLine.split(/\s+(?:https?:\/\/|\*\s)/)[0] ?? firstLine;
  const sentence = beforeLink.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? beforeLink;
  const trimmed = sentence.trim().replace(/[.,;:]+$/, "");
  return trimmed.length > MAX_REASON_CHARS ? `${trimmed.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…` : trimmed || "unknown reason";
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
    if (event.status === "SUCCEEDED")
      return event.output?.reusedFrom
        ? `Reused the brief from ${event.output.reusedFrom}: ${event.output.facts ?? 0} facts, nothing to research again`
        : `Sources read${took(event)}`;
    if (event.status === "FAILED") return `Could not finish reading: ${shortReason(event.error)}`;
    return null;
  }
  if (event.status === "STARTED") return "Picking out the facts…";
  if (event.status === "SUCCEEDED")
    return ctx.claimCount === undefined
      ? "Facts recorded"
      : `Recording ${ctx.claimCount} ${ctx.claimCount === 1 ? "fact" : "facts"}`;
  if (event.status === "FAILED") return `Could not record the facts: ${shortReason(event.error)}`;
  return null;
}

function skillsLine(event: ProgressEvent): string | null {
  if (event.status === "STARTED") return "Choosing playbooks…";
  if (event.status === "FAILED") return `Could not choose playbooks: ${shortReason(event.error)}`;
  if (event.status !== "SUCCEEDED") return null;
  const names = event.output?.skills ?? [];
  return names.length > 0 ? `Following ${listNames(names)}` : "No playbook needed";
}

function strategyLine(event: ProgressEvent, ctx: Ctx): string | null {
  if (parseStep(event.step).head === "skills") return skillsLine(event);
  const name = nameOf(ctx, parseStep(event.step).runAccountId);
  if (event.status === "STARTED") return `Choosing an angle for ${name}…`;
  if (event.status === "SUCCEEDED") return `Angle chosen for ${name}`;
  if (event.status === "FAILED" || event.status === "SKIPPED") return `No angle for ${name}: ${event.error ? shortReason(event.error) : "skipped"}`;
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

function platformReviewLine(event: ProgressEvent, ctx: Ctx, draft: string, runAccountId?: string): string | null {
  const where = runAccountId
    ? platformName(ctx.accounts.find((a) => a.runAccountId === runAccountId)?.platform ?? "")
    : "";
  const target = where ? ` for ${where}` : "";
  if (event.status === "STARTED") return `Reading ${draft.replace(/^Draft/, "draft")} as a ${where || "platform"} reader…`;
  if (event.status === "SKIPPED" || event.status === "FAILED") return `${draft} could not be reviewed${target}`;
  if (event.status !== "SUCCEEDED" || !event.output) return null;
  const count = event.output.issues?.length ?? 0;
  if (count === 0) return `${draft} reads well${target}`;
  const noted = `${count} ${count === 1 ? "note" : "notes"}`;
  if (event.output.verdict === "REVISE") return event.output.fixed ? `${draft}: ${noted}, fixed` : `${draft}: ${noted}, kept as is`;
  return `${draft}: ${noted}${target}`;
}

function reviewLine(event: ProgressEvent, ctx: Ctx): string | null {
  const { head, runAccountId, label, suffix } = parseStep(event.step);
  const draft = label ? `Draft ${label}` : "The draft";
  switch (head) {
    case "checks":
      if (suffix === "revision" || suffix === "review-fix")
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
      return `${draft} dropped: ${event.error ? shortReason(event.error) : "it did not pass the checks"}`;
    case "review":
      if (label) return platformReviewLine(event, ctx, draft, runAccountId);
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
    if (event.status === "FAILED") return `Could not create an image${target}: ${shortReason(event.error)}`;
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
// Progressive reveal: agents appear one after another
// ---------------------------------------------------------------------------

export interface RevealedStage {
  stage: ProgressStage;
  /** True for the one agent shown ahead of the work as "up next"; nothing beyond it is shown. */
  hint: boolean;
}

/**
 * The stages a picture should show right now: everyone who has worked or is
 * working, plus the next agent in line as a hint. Agents further ahead stay
 * out of sight until the work reaches them, so the run reads as a relay. A
 * finished or halted run shows everyone who took part.
 */
export function revealStages(stages: readonly ProgressStage[]): RevealedStage[] {
  const shown: RevealedStage[] = [];
  for (const stage of stages) {
    if (stage.state === "pending") {
      const previous = shown[shown.length - 1];
      const halted = previous?.stage.state === "failed";
      if (!halted) shown.push({ stage, hint: true });
      break;
    }
    shown.push({ stage, hint: false });
  }
  return shown;
}

// ---------------------------------------------------------------------------
// Transcript: the run as a conversation
// ---------------------------------------------------------------------------

export interface TranscriptMessage {
  /** The event's id, stable across refreshes. */
  id: string;
  agent: ProgressStageKey;
  /** Writer label (A, B, C) when the speaker is one of the writers. */
  label?: string;
  runAccountId?: string;
  text: string;
  tone: "info" | "success" | "failed";
  /** ISO timestamp. */
  at: string;
  provider?: string | null;
  model?: string | null;
  /** Rich details the event carried: a draft preview, a verdict, the judge's scores. */
  output?: ProgressEvent["output"];
}

function toneOf(status: string): TranscriptMessage["tone"] {
  if (status === "FAILED") return "failed";
  return status === "SUCCEEDED" ? "success" : "info";
}

/**
 * One message per event that has something to say, oldest first, so the run
 * reads like a room full of agents talking. Uses the same lines as the stage
 * view; a line repeated by the same agent is said once.
 */
export function buildTranscript(
  events: readonly ProgressEvent[],
  accounts: readonly ProgressAccount[],
  extras: ProgressExtras = {},
): TranscriptMessage[] {
  const ordered = latestAttempt([...events].sort(byTime));
  const ctx: Ctx = {
    accounts,
    candidates: countCandidates(ordered),
    many: accounts.length > 1,
    claimCount: extras.claimCount,
  };
  const messages: TranscriptMessage[] = [];
  for (const event of ordered) {
    const key = stageOfStep(event.step);
    if (!key) continue;
    const text = lineFor(key, event, ctx);
    if (!text) continue;
    const previous = messages[messages.length - 1];
    if (previous && previous.agent === key && previous.text === text) continue;
    const parsed = parseStep(event.step);
    messages.push({
      id: event.id,
      agent: key,
      ...(key === "drafting" && parsed.label ? { label: parsed.label } : {}),
      ...(parsed.runAccountId ? { runAccountId: parsed.runAccountId } : {}),
      text,
      tone: toneOf(event.status),
      at: event.at,
      provider: event.provider ?? null,
      model: event.model ?? null,
      ...(event.output ? { output: event.output } : {}),
    });
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Live board: who is doing what, with which model
// ---------------------------------------------------------------------------

export type SeatRole = "research" | "strategy" | "writer" | "review" | "judge" | "adapt";

export interface AgentSeat {
  role: SeatRole;
  /** "Researcher", "Writer B", … */
  name: string;
  /** Draft label for writers. */
  label?: string;
  provider?: string;
  model?: string;
  /** Short display name of the model, e.g. "Gemini 2.5 Flash". */
  modelLabel?: string;
  /** Every model that sat in this seat, first seen first: one entry normally, three when a council sat. */
  models?: string[];
  state: ProgressStageState;
  /** Latest plain-language line for this seat. */
  detail: string;
  latencyMs?: number;
  /** Writers: a preview of the draft as soon as it exists. */
  draft?: string;
  /** Writers: the blind judge's score (0-60) and reason once judged. */
  score?: number;
  rationale?: string;
  /** Writers: the platform reviewer's verdict once reviewed. */
  reviewVerdict?: string;
  reviewIssues?: number;
  winner?: boolean;
  /** Writers: the draft shown is live partial text, still arriving. */
  streaming?: boolean;
}

export interface AgentBoard {
  /** Single-seat agents in pipeline order. */
  seats: AgentSeat[];
  /** One seat per writer label, in label order. */
  writers: AgentSeat[];
  /** The model behind each stage, for the arc's captions. */
  modelsByStage: Partial<Record<ProgressStageKey, string>>;
}

const MODEL_WORDS: Record<string, string> = {
  gemini: "Gemini",
  claude: "Claude",
  gpt: "GPT",
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  flash: "Flash",
  pro: "Pro",
  lite: "Lite",
  mini: "Mini",
  preview: "Preview",
};

/** "claude-fable-5-1" → "Claude Fable 5.1", "gemini-2.5-flash" → "Gemini 2.5 Flash", "claude-opus-5[1m]" → "Claude Opus 5 1M". */
export function modelLabel(model: string | null | undefined, provider?: string | null): string | undefined {
  if (!model) return provider ? providerName(provider) : undefined;
  // A bracketed variant such as "[1m]" (the long-context edition) is a suffix, not part of the version.
  const variant = model.match(/\[([^\]]+)\]\s*$/)?.[1]?.toUpperCase();
  const bare = model.replace(/\[[^\]]*\]\s*$/, "").replace(/^.*\//, "").replace(/-\d{8}$/, "");
  const words = [...bare.split(/[-_]/).filter(Boolean), ...(variant ? [variant] : [])];
  const out: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (MODEL_WORDS[lower]) {
      out.push(MODEL_WORDS[lower]);
    } else if (/^\d+$/.test(w) && out.length > 0 && /^\d+(\.\d+)?$/.test(out[out.length - 1] ?? "")) {
      out[out.length - 1] = `${out[out.length - 1]}.${w}`;
    } else if (/^\d/.test(w)) {
      out.push(w);
    } else {
      out.push(w.charAt(0).toUpperCase() + w.slice(1));
    }
  }
  return out.join(" ");
}

function seatState(status: string): ProgressStageState {
  if (status === "STARTED") return "active";
  if (status === "SUCCEEDED") return "done";
  if (status === "FAILED") return "failed";
  return "skipped";
}

function singleSeat(role: SeatRole, name: string, key: ProgressStageKey, heads: readonly string[], stage: ProgressStage | undefined, ordered: readonly ProgressEvent[]): AgentSeat {
  const own = ordered.filter((e) => heads.includes(parseStep(e.step).head) && e.provider);
  const last = own[own.length - 1];
  // A failed attempt that was handed to another model is not a seat on the bench.
  const failedModels = new Set(own.filter((e) => e.status === "FAILED").map((e) => `${e.provider}::${e.model}`));
  const succeeded = new Set(own.filter((e) => e.status === "SUCCEEDED").map((e) => `${e.provider}::${e.model}`));
  const models = [
    ...new Set(
      own
        .filter((e) => e.model && (!failedModels.has(`${e.provider}::${e.model}`) || succeeded.has(`${e.provider}::${e.model}`)))
        .map((e) => modelLabel(e.model, e.provider))
        .filter((m): m is string => Boolean(m)),
    ),
  ];
  return {
    role,
    name,
    provider: last?.provider ?? undefined,
    model: last?.model ?? undefined,
    modelLabel: modelLabel(last?.model, last?.provider),
    ...(models.length > 0 ? { models } : {}),
    state: stage?.state ?? "pending",
    detail: stage?.activity.at(-1) ?? stage?.label ?? "",
    ...(last?.latencyMs ? { latencyMs: last.latencyMs } : {}),
    ...(stage?.key === key ? {} : {}),
  };
}

/**
 * The live board behind the arc: which model sits in each seat, every writer
 * with its draft as it lands, then the reviewer's verdict and the judge's
 * score on each. Same inputs as `buildProgress`, so the two never disagree.
 */
export function buildBoard(status: string, events: readonly ProgressEvent[], accounts: readonly ProgressAccount[]): AgentBoard {
  const ordered = latestAttempt([...events].sort(byTime));
  const progress = buildProgress(status, events, accounts);
  const stage = (key: ProgressStageKey) => progress.stages.find((s) => s.key === key);

  const seats: AgentSeat[] = [
    singleSeat("research", "Researcher", "research", ["research", "claims"], stage("research"), ordered),
    singleSeat("strategy", "Strategist", "strategy", ["strategy", "skills"], stage("strategy"), ordered),
    singleSeat("review", "Reviewer", "review", ["review", "cross-review"], stage("review"), ordered),
    singleSeat("judge", "Judge", "judge", ["judge"], stage("judge"), ordered),
    singleSeat("adapt", "Editor", "adapt", ["adapt", "synthesis", "media"], stage("adapt"), ordered),
  ];

  const writers = new Map<string, AgentSeat>();
  for (const e of ordered) {
    const { head, label, suffix } = parseStep(e.step);
    if (head === "judge.verdict" && e.output) {
      for (const s of e.output.scores ?? []) {
        const current = writers.get(s.label);
        if (current) writers.set(s.label, { ...current, score: s.score, rationale: s.rationale, winner: e.output.winner === s.label });
      }
      if (e.output.winner && !(e.output.scores ?? []).length) {
        const current = writers.get(e.output.winner);
        if (current) writers.set(e.output.winner, { ...current, winner: true });
      }
      continue;
    }
    if (!label) continue;
    if (head === "writer" || (head === "revision" && !suffix) || (head === "revision" && suffix === "review-fix")) {
      const current = writers.get(label) ?? { role: "writer" as const, name: `Writer ${label}`, label, state: "pending" as ProgressStageState, detail: "" };
      const isWriter = head === "writer";
      writers.set(label, {
        ...current,
        provider: isWriter ? (e.provider ?? current.provider) : current.provider,
        model: isWriter ? (e.model ?? current.model) : current.model,
        modelLabel: isWriter ? modelLabel(e.model ?? current.model, e.provider ?? current.provider) : current.modelLabel,
        state: isWriter ? seatState(e.status) : current.state,
        detail: isWriter
          ? e.status === "STARTED"
            ? "Drafting…"
            : e.status === "SUCCEEDED"
              ? `Draft ready${e.latencyMs ? ` · ${formatDuration(e.latencyMs)}` : ""}`
              : "Did not finish"
          : e.status === "SUCCEEDED"
            ? suffix === "review-fix"
              ? "Fixed after the platform review"
              : "Fixed after the checks"
            : current.detail,
        ...(isWriter && e.latencyMs ? { latencyMs: e.latencyMs } : {}),
        ...(e.status === "SUCCEEDED" && e.output?.draft ? { draft: e.output.draft } : {}),
      });
    }
    if (head === "review" && e.status === "SUCCEEDED" && e.output?.verdict) {
      const current = writers.get(label);
      if (current) writers.set(label, { ...current, reviewVerdict: e.output.verdict, reviewIssues: e.output.issues?.length ?? 0 });
    }
  }

  const modelsByStage: Partial<Record<ProgressStageKey, string>> = {};
  for (const seat of seats) {
    const key: ProgressStageKey = seat.role === "research" ? "research" : seat.role === "strategy" ? "strategy" : seat.role === "review" ? "review" : seat.role === "judge" ? "judge" : "adapt";
    if (seat.models && seat.models.length > 1) modelsByStage[key] = `${seat.models.length} models`;
    else if (seat.modelLabel) modelsByStage[key] = seat.modelLabel;
  }
  const writerModels = [...new Set([...writers.values()].map((w) => w.modelLabel).filter(Boolean))] as string[];
  if (writerModels.length > 0) modelsByStage.drafting = writerModels.length === 1 ? writerModels[0] : `${writerModels.length} models`;

  return {
    seats,
    writers: [...writers.values()].sort((a, b) => (a.label ?? "").localeCompare(b.label ?? "")),
    modelsByStage,
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
