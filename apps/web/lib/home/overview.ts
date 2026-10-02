/**
 * The small facts Home shows next to the one current post: what else waits
 * for a decision, and which models actually wrote drafts today.
 */
import { AGENT_PIPELINE, type AgentRunStatus } from "@platform/types";
import { prisma } from "@/lib/db";
import { monthlyBudgetStatus } from "@/lib/agent/budget";
import { modelLabel, platformName, providerName, stageOfStep } from "@platform/agent-council/progress";

export interface WaitingItem {
  runId: string;
  topic: string;
  accounts: string[];
  platforms: string[];
  /** Best judge score among the pending winners, 0-10, when known. */
  score: number | null;
  waitingSince: string;
  /** Who started it: the starter may not approve their own campaign unless they are an owner or admin. */
  createdById: string;
  /** First lines of the recommended text. */
  excerpt: string;
  /** When it publishes once approved (ISO), when the run has a time. */
  goesOutAt: string | null;
  /** Pending run-account ids, for approving straight from Today. */
  pendingAccountIds: string[];
  assurance: string;
  spentCents: number;
  /** Distinct models that wrote drafts. */
  models: number;
  /** Checks on the winning drafts: clean when every check passed. */
  checksClean: boolean | null;
  issues: number;
}

export interface ModelUse {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  drafts: number;
}

const WAITING_LIMIT = 8;
const MODELS_WINDOW_MS = 24 * 60 * 60_000;

/** Runs awaiting a decision, oldest first, minus the one already shown in full. */
export async function loadAlsoWaiting(organizationId: string, excludeRunId?: string): Promise<WaitingItem[]> {
  const runs = await prisma.agentRun.findMany({
    where: { organizationId, status: "AWAITING_APPROVAL", ...(excludeRunId ? { id: { not: excludeRunId } } : {}) },
    orderBy: { updatedAt: "asc" },
    take: WAITING_LIMIT,
    select: {
      id: true,
      topic: true,
      updatedAt: true,
      createdById: true,
      scheduledAt: true,
      assurance: true,
      spentCents: true,
      accounts: {
        select: {
          id: true,
          decision: true,
          platform: true,
          finalText: true,
          editedText: true,
          winnerDraftId: true,
          socialAccount: { select: { displayName: true } },
          drafts: { select: { id: true, judgeScore: true, model: true, checks: true } },
        },
      },
    },
  });
  return runs.map((run) => {
    const pending = run.accounts.filter((a) => a.decision === "PENDING");
    const winners = pending.map((a) => a.drafts.find((d) => d.id === a.winnerDraftId)).filter((d) => d !== undefined);
    const scores = winners.map((d) => d.judgeScore).filter((s): s is number => typeof s === "number");
    const checks = winners.map((d) => readChecks(d.checks)).filter((c) => c !== null);
    const text = pending.map((a) => a.editedText ?? a.finalText ?? "").find((t) => t.trim()) ?? "";
    return {
      runId: run.id,
      topic: run.topic,
      accounts: pending.map((a) => a.socialAccount.displayName),
      platforms: pending.map((a) => a.platform),
      score: scores.length ? Math.round((Math.max(...scores) / 6) * 10) / 10 : null,
      waitingSince: run.updatedAt.toISOString(),
      createdById: run.createdById,
      excerpt: text.replace(/\s+/g, " ").trim().slice(0, 220),
      goesOutAt: run.scheduledAt?.toISOString() ?? null,
      pendingAccountIds: pending.map((a) => a.id),
      assurance: run.assurance,
      spentCents: run.spentCents,
      models: new Set(run.accounts.flatMap((a) => a.drafts.map((d) => d.model))).size,
      checksClean: checks.length ? checks.every((c) => c.ok) : null,
      issues: checks.reduce((sum, c) => sum + c.issues, 0),
    };
  });
}

function readChecks(value: unknown): { ok: boolean; issues: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { ok?: unknown; issues?: unknown };
  return { ok: v.ok === true, issues: Array.isArray(v.issues) ? v.issues.length : 0 };
}

/** Which models wrote drafts in the last day, busiest first. Answers "is it only using one model?". */
export async function loadModelsToday(organizationId: string): Promise<ModelUse[]> {
  const since = new Date(Date.now() - MODELS_WINDOW_MS);
  const drafts = await prisma.agentDraft.groupBy({
    by: ["provider", "model"],
    where: { runAccount: { run: { organizationId, createdAt: { gte: since } } } },
    _count: { _all: true },
  });
  return drafts
    .map((d) => ({
      provider: d.provider,
      providerLabel: providerName(d.provider),
      model: d.model,
      label: modelLabel(d.model, d.provider) ?? d.model,
      drafts: d._count._all,
    }))
    .sort((a, b) => b.drafts - a.drafts);
}

// ---------------------------------------------------------------------------
// App shell: rail badges and the budget card
// ---------------------------------------------------------------------------

/** Matches `OrganizationSettings.agentMaxActiveRuns` default. */
const DEFAULT_MAX_ACTIVE_RUNS = 5;
const ACTIVE: readonly AgentRunStatus[] = ["QUEUED", ...AGENT_PIPELINE, "APPROVED", "PUBLISHING"];

export interface ShellData {
  hasWhatsApp: boolean;
  /** Campaigns parked at AWAITING_APPROVAL. */
  awaitingCount: number;
  /** Sum of unread WhatsApp conversations. */
  unreadCount: number;
  /** Null when the viewer may not see spend. */
  budget: { spentCents: number; budgetCents: number; activeRuns: number; maxActiveRuns: number } | null;
}

/** Everything the app shell (rail badges, budget card) needs, in one round of queries. */
export async function loadShellData(organizationId: string, opts: { withBudget: boolean }): Promise<ShellData> {
  const [whatsAppAccounts, awaitingCount, unread, activeRuns, settings, budget] = await Promise.all([
    prisma.whatsAppAccount.count({ where: { organizationId } }),
    prisma.agentRun.count({ where: { organizationId, status: "AWAITING_APPROVAL" } }),
    prisma.conversation.aggregate({ where: { organizationId, unreadCount: { gt: 0 } }, _sum: { unreadCount: true } }),
    opts.withBudget ? prisma.agentRun.count({ where: { organizationId, status: { in: [...ACTIVE] } } }) : 0,
    opts.withBudget
      ? prisma.organizationSettings.findUnique({ where: { organizationId }, select: { agentMaxActiveRuns: true } })
      : null,
    opts.withBudget ? monthlyBudgetStatus(organizationId) : null,
  ]);
  return {
    hasWhatsApp: whatsAppAccounts > 0,
    awaitingCount,
    unreadCount: unread._sum.unreadCount ?? 0,
    budget: budget
      ? {
          spentCents: budget.spentCents + budget.reservedCents,
          budgetCents: budget.budgetCents,
          activeRuns,
          maxActiveRuns: settings?.agentMaxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Today: agenda, attention, results, learnings, activity
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const UPCOMING_STATUSES = ["SCHEDULED", "APPROVED", "QUEUED"] as const;
const LIVE_RUN: readonly AgentRunStatus[] = ["QUEUED", ...AGENT_PIPELINE];

/** How far `timeZone` is ahead of UTC at `at`, in ms. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** Midnight today in the organization's time zone, as a real instant. */
export function startOfDayIn(timeZone: string, at: Date = new Date()): Date {
  const offset = zoneOffsetMs(at, timeZone);
  const local = new Date(at.getTime() + offset);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocal - zoneOffsetMs(new Date(midnightLocal - offset), timeZone));
}

export type WeekItemKind = "published" | "scheduled" | "ready" | "writing" | "failed";

export interface WeekItem {
  key: string;
  href: string;
  platform: string;
  title: string;
  kind: WeekItemKind;
}

export interface WeekDay {
  /** ISO instant of the day's start in the organization's zone. */
  date: string;
  items: WeekItem[];
}

export interface UpcomingPost {
  postId: string;
  title: string;
  scheduledAt: string;
  platforms: string[];
}

export interface AttentionItem {
  key: string;
  kind: "account" | "failed_post" | "blocked_run";
  title: string;
  detail: string;
  /** One mono line of machinery for the Detailed view. */
  technical: string;
  href: string;
  action: { label: string; kind: "link" | "retry_post" | "resume_run"; id?: string };
}

export interface InboxPreview {
  conversationId: string;
  name: string;
  preview: string;
  unread: number;
  at: string | null;
  suggestion: boolean;
}

export interface SetupStep {
  key: "account" | "ai" | "brand" | "first_approval" | "plan" | "stories";
  label: string;
  done: boolean;
  href: string;
}

export interface PlanGlance {
  planId: string;
  name: string;
  started: number;
  total: number;
  /** Days left in the plan from today. */
  daysLeft: number;
  next: { index: number; date: string; platform: string; title: string } | null;
}

export interface ResultTile {
  value: number;
  /** Change against the 30 days before, as a fraction; null without a baseline. */
  change: number | null;
  /** Twelve buckets across the last 30 days. */
  spark: number[];
}

export interface AccountResult {
  accountId: string;
  platform: string;
  name: string;
  posts: number;
  impressions: number;
  engagementRate: number | null;
  median: number;
}

export interface TodayResults {
  published: number;
  accountsPublishing: number;
  reach: ResultTile;
  engagement: ResultTile;
  contacts: ResultTile;
  /** Platform carrying the most reach and its share, when there is reach at all. */
  leader: { platform: string; share: number } | null;
  accounts: AccountResult[];
  lastSnapshotAt: string | null;
}

export interface Learning {
  key: string;
  text: string;
  /** "High" / "Medium" / "From your edits". */
  confidence: string;
  /** 0-100 for the meter. */
  strength: number;
  basis: string;
  action:
    | { kind: "fill"; label: string; prompt: string }
    | { kind: "link"; label: string; href: string }
    | { kind: "forget"; label: string; accountId: string; index: number };
}

export type ActivityKind = "council" | "publish" | "webhook" | "whatsapp" | "learning" | "audit" | "error";

export interface ActivityEntry {
  key: string;
  at: string;
  kind: ActivityKind;
  text: string;
  error: boolean;
}

export interface QueueRow {
  name: string;
  active: number;
  waiting: number;
  waitingLabel: string;
  bad: boolean;
}

export interface SpendBreakdown {
  stages: { label: string; cents: number }[];
  models: { model: string; calls: number; cents: number }[];
}

export interface TodayAgenda {
  week: WeekDay[];
  upcoming: UpcomingPost[];
  attention: AttentionItem[];
  inbox: InboxPreview[];
  setup: SetupStep[];
  plan: PlanGlance | null;
  results: TodayResults;
  learnings: Learning[];
  /** Awaiting campaigns that would publish once approved. */
  awaitingCount: number;
}

function planItems(value: unknown): { date?: unknown; runId?: unknown; platform?: unknown; title?: unknown; idea?: unknown }[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];
}

const num = (m: unknown, k: string): number =>
  typeof m === "object" && m !== null && typeof (m as Record<string, unknown>)[k] === "number"
    ? ((m as Record<string, number>)[k] ?? 0)
    : 0;

function buckets(points: { at: number; value: number }[], from: number, to: number, n = 12): number[] {
  const out = Array.from({ length: n }, () => 0);
  const span = (to - from) / n;
  for (const p of points) {
    if (p.at < from || p.at >= to) continue;
    out[Math.min(n - 1, Math.floor((p.at - from) / span))]! += p.value;
  }
  return out;
}

function change(now: number, before: number): number | null {
  return before > 0 ? (now - before) / before : null;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const HOOK_WORDS: Record<string, string> = {
  question: "open with a question",
  number: "open with a surprising number",
  story: "open with a short story",
  statement: "open with a bold statement",
};

/**
 * Everything Today shows beyond the waiting list, all scoped to one
 * organization: the week, what broke, who wrote in, results, what the
 * council learned and what is left to set up.
 */
export async function loadTodayAgenda(
  organizationId: string,
  opts: { hasAiProvider: boolean; hasWhatsApp: boolean; timeZone: string; canEditMemory: boolean },
): Promise<TodayAgenda> {
  const now = Date.now();
  const today = startOfDayIn(opts.timeZone);
  const weekEnd = new Date(today.getTime() + 7 * DAY_MS);
  const since30 = new Date(now - 30 * DAY_MS);
  const since60 = new Date(now - 60 * DAY_MS);

  const [variants, failed, accounts, blocked, liveRuns, awaiting, conversations, brands, approvals, plan, snapshots, contacts, stories, profiles] =
    await Promise.all([
      prisma.postVariant.findMany({
        where: {
          post: { organizationId },
          OR: [
            { status: { in: [...UPCOMING_STATUSES] }, post: { scheduledAt: { gte: today, lt: weekEnd } } },
            { status: "PUBLISHED", publishedAt: { gte: today, lt: weekEnd } },
            { status: { in: ["FAILED", "DISCONNECTED_ACCOUNT"] }, post: { scheduledAt: { gte: today, lt: weekEnd } } },
          ],
        },
        take: 80,
        select: {
          id: true,
          platform: true,
          status: true,
          publishedAt: true,
          post: { select: { id: true, title: true, masterText: true, scheduledAt: true } },
        },
      }),
      prisma.post.findMany({
        where: { organizationId, status: { in: ["FAILED", "DISCONNECTED_ACCOUNT"] }, updatedAt: { gte: new Date(now - 7 * DAY_MS) } },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: {
          id: true,
          title: true,
          masterText: true,
          status: true,
          variants: {
            where: { status: { in: ["FAILED", "DISCONNECTED_ACCOUNT"] } },
            take: 1,
            select: {
              platform: true,
              lastError: true,
              publishJobs: { orderBy: { updatedAt: "desc" }, take: 1, select: { id: true, attemptCount: true, maxAttempts: true } },
            },
          },
        },
      }),
      prisma.socialAccount.findMany({
        where: { organizationId },
        select: { id: true, displayName: true, platform: true, status: true, lastError: true, updatedAt: true },
      }),
      prisma.agentRun.findMany({
        where: { organizationId, status: { in: ["BLOCKED", "PAUSED", "FAILED"] }, updatedAt: { gte: new Date(now - 2 * DAY_MS) } },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { id: true, topic: true, status: true, blockedReason: true, error: true, updatedAt: true },
      }),
      prisma.agentRun.findMany({
        where: { organizationId, status: { in: [...LIVE_RUN] } },
        select: { id: true, topic: true, platforms: true },
      }),
      prisma.agentRun.findMany({
        where: { organizationId, status: "AWAITING_APPROVAL" },
        select: { id: true, topic: true, scheduledAt: true, accounts: { where: { decision: "PENDING" }, select: { platform: true } } },
      }),
      opts.hasWhatsApp
        ? prisma.conversation.findMany({
            where: { organizationId, unreadCount: { gt: 0 } },
            orderBy: { lastMessageAt: "desc" },
            take: 3,
            select: {
              id: true,
              unreadCount: true,
              lastMessageAt: true,
              lastMessagePreview: true,
              contact: { select: { name: true, phone: true } },
              messages: { where: { aiSuggested: true, createdAt: { gte: new Date(now - DAY_MS) } }, take: 1, select: { id: true } },
            },
          })
        : [],
      prisma.brand.count({ where: { organizationId } }),
      prisma.agentRunAccount.count({ where: { run: { organizationId }, decision: "APPROVED" } }),
      prisma.contentPlan.findFirst({
        where: { organizationId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, theme: true, items: true, startDate: true, days: true },
      }),
      prisma.postVariant.findMany({
        where: { post: { organizationId }, status: "PUBLISHED", publishedAt: { gte: since60 } },
        select: {
          socialAccountId: true,
          platform: true,
          publishedAt: true,
          snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { metrics: true, capturedAt: true } },
        },
      }),
      opts.hasWhatsApp
        ? prisma.contact.findMany({ where: { organizationId, createdAt: { gte: since60 } }, select: { createdAt: true } })
        : [],
      prisma.brandKnowledge.count({ where: { brand: { organizationId }, sourceType: "STORY" } }).catch(() => 0),
      prisma.accountProfile.findMany({
        where: { organizationId },
        select: { socialAccountId: true, performance: true, humanFeedback: true, sampleSize: true, socialAccount: { select: { displayName: true, platform: true } } },
      }),
    ]);

  // ---- the week
  const week: WeekDay[] = Array.from({ length: 7 }, (_, i) => ({ date: new Date(today.getTime() + i * DAY_MS).toISOString(), items: [] }));
  const dayIndex = (d: Date | null | undefined) => (d ? Math.floor((d.getTime() - today.getTime()) / DAY_MS) : -1);
  for (const v of variants) {
    const when = v.status === "PUBLISHED" ? v.publishedAt : v.post.scheduledAt;
    const i = dayIndex(when);
    if (i < 0 || i > 6) continue;
    week[i]!.items.push({
      key: v.id,
      href: `/posts/${v.post.id}`,
      platform: v.platform,
      title: v.post.title || v.post.masterText.slice(0, 60),
      kind: v.status === "PUBLISHED" ? "published" : v.status === "FAILED" || v.status === "DISCONNECTED_ACCOUNT" ? "failed" : "scheduled",
    });
  }
  for (const run of awaiting) {
    const i = run.scheduledAt ? dayIndex(run.scheduledAt) : -1;
    if (i < 0 || i > 6) continue;
    for (const [n, a] of run.accounts.entries())
      week[i]!.items.push({ key: `${run.id}:${n}`, href: `/review/${run.id}`, platform: a.platform, title: run.topic, kind: "ready" });
  }
  for (const run of liveRuns)
    for (const [n, p] of run.platforms.entries())
      week[0]!.items.push({ key: `${run.id}:live:${n}`, href: `/agent/${run.id}/live`, platform: p, title: run.topic, kind: "writing" });

  // ---- going out soon
  const upcomingMap = new Map<string, UpcomingPost>();
  for (const v of variants) {
    if (v.status === "PUBLISHED" || v.status === "FAILED" || v.status === "DISCONNECTED_ACCOUNT" || !v.post.scheduledAt) continue;
    if (v.post.scheduledAt.getTime() < now) continue;
    const cur = upcomingMap.get(v.post.id);
    if (cur) cur.platforms = [...new Set([...cur.platforms, v.platform])];
    else
      upcomingMap.set(v.post.id, {
        postId: v.post.id,
        title: v.post.title || v.post.masterText.slice(0, 80),
        scheduledAt: v.post.scheduledAt.toISOString(),
        platforms: [v.platform],
      });
  }
  const upcoming = [...upcomingMap.values()].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 3);

  // ---- needs attention
  const stamp = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: opts.timeZone });
  const attention: AttentionItem[] = [
    ...accounts
      .filter((a) => a.status === "EXPIRED" || a.status === "ERROR")
      .map((a) => ({
        key: `acc:${a.id}`,
        kind: "account" as const,
        title: a.status === "EXPIRED" ? `${platformLabel(a.platform)} sign-in expired` : `${platformLabel(a.platform)} stopped syncing`,
        detail: `Posts to ${a.displayName} are paused until it is reconnected.`,
        technical: `SocialAccount ${a.status} · ${a.lastError ?? "token_expired"} · ${stamp(a.updatedAt)}`,
        href: "/accounts",
        action: { label: "Reconnect", kind: "link" as const },
      })),
    ...failed.map((p) => {
      const v = p.variants[0];
      const job = v?.publishJobs[0];
      return {
        key: `post:${p.id}`,
        kind: "failed_post" as const,
        title: v ? `${platformLabel(v.platform)} didn’t publish` : "A post didn’t publish",
        detail: `“${(p.title || p.masterText).slice(0, 60)}” ${p.status === "DISCONNECTED_ACCOUNT" ? "is waiting for its account to be reconnected." : "can be tried again."}`,
        technical: [job ? `PublishJob ${job.id.slice(0, 8)}` : "Post", p.status, v?.lastError, job ? `attempt ${job.attemptCount}/${job.maxAttempts}` : null]
          .filter(Boolean)
          .join(" · "),
        href: `/posts/${p.id}`,
        action: p.status === "DISCONNECTED_ACCOUNT" ? { label: "Reconnect", kind: "link" as const } : { label: "Retry", kind: "retry_post" as const, id: p.id },
      };
    }),
    ...blocked.map((r) => ({
      key: `run:${r.id}`,
      kind: "blocked_run" as const,
      title: r.status === "PAUSED" ? "A post is paused" : r.status === "FAILED" ? "The council stopped" : "The council needs you",
      detail: `“${r.topic.slice(0, 60)}” — ${r.status === "BLOCKED" ? (r.blockedReason ?? "it stopped to check with you") : r.status === "FAILED" ? "something went wrong" : "carry on when you are ready"}.`,
      technical: `run ${r.status} · ${(r.error ?? r.blockedReason ?? "").slice(0, 60)} · ${stamp(r.updatedAt)}`,
      href: `/review/${r.id}`,
      action: { label: r.status === "FAILED" ? "Try again" : "Carry on", kind: "resume_run" as const, id: r.id },
    })),
  ];

  // ---- results
  const t30 = since30.getTime();
  const t60 = since60.getTime();
  const pts = snapshots.map((v) => {
    const m = v.snapshots[0]?.metrics;
    return {
      at: v.publishedAt?.getTime() ?? 0,
      accountId: v.socialAccountId,
      platform: v.platform,
      reach: num(m, "impressions"),
      eng: num(m, "likes") + num(m, "comments") + num(m, "shares"),
      capturedAt: v.snapshots[0]?.capturedAt ?? null,
    };
  });
  const cur = pts.filter((p) => p.at >= t30);
  const prev = pts.filter((p) => p.at >= t60 && p.at < t30);
  const sum = (xs: typeof pts, k: "reach" | "eng") => xs.reduce((a, p) => a + p[k], 0);
  const contactNow = contacts.filter((c) => c.createdAt.getTime() >= t30);
  const byPlatform = new Map<string, number>();
  for (const p of cur) byPlatform.set(p.platform, (byPlatform.get(p.platform) ?? 0) + p.reach);
  const totalReach = sum(cur, "reach");
  const top = [...byPlatform.entries()].sort((a, b) => b[1] - a[1])[0];
  const accountRows: AccountResult[] = accounts
    .map((a) => {
      const mine = cur.filter((p) => p.accountId === a.id);
      const reach = mine.reduce((x, p) => x + p.reach, 0);
      const eng = mine.reduce((x, p) => x + p.eng, 0);
      return {
        accountId: a.id,
        platform: a.platform,
        name: a.displayName,
        posts: mine.length,
        impressions: reach,
        engagementRate: reach > 0 ? eng / reach : null,
        median: median(mine.map((p) => p.reach)),
      };
    })
    .filter((r) => r.posts > 0)
    .sort((a, b) => b.impressions - a.impressions);
  const lastSnap = pts.map((p) => p.capturedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  const results: TodayResults = {
    published: cur.length,
    accountsPublishing: new Set(cur.map((p) => p.accountId)).size,
    reach: { value: totalReach, change: change(totalReach, sum(prev, "reach")), spark: buckets(cur.map((p) => ({ at: p.at, value: p.reach })), t30, now) },
    engagement: {
      value: sum(cur, "eng"),
      change: change(sum(cur, "eng"), sum(prev, "eng")),
      spark: buckets(cur.map((p) => ({ at: p.at, value: p.eng })), t30, now),
    },
    contacts: {
      value: contactNow.length,
      change: change(contactNow.length, contacts.length - contactNow.length),
      spark: buckets(contactNow.map((c) => ({ at: c.createdAt.getTime(), value: 1 })), t30, now),
    },
    leader: top && totalReach > 0 ? { platform: top[0], share: top[1] / totalReach } : null,
    accounts: accountRows,
    lastSnapshotAt: lastSnap ? new Date(lastSnap).toISOString() : null,
  };

  // ---- what the council learned
  const learnings: Learning[] = [];
  for (const prof of profiles) {
    const perf = (prof.performance ?? {}) as { bestHooks?: unknown; bestPostingWindows?: unknown; confidence?: unknown; sampleSize?: unknown };
    const conf = typeof perf.confidence === "number" ? perf.confidence : 0;
    const n = typeof perf.sampleSize === "number" ? perf.sampleSize : prof.sampleSize;
    const label = conf >= 0.7 ? "High" : conf >= 0.4 ? "Medium" : "Early";
    const hook = Array.isArray(perf.bestHooks) ? perf.bestHooks.find((h): h is string => typeof h === "string") : undefined;
    if (hook)
      learnings.push({
        key: `hook:${prof.socialAccountId}`,
        text: `Posts that ${HOOK_WORDS[hook] ?? `use a ${hook} opening`} do best on ${prof.socialAccount.displayName}.`,
        confidence: label,
        strength: Math.round(conf * 100),
        basis: `${n} posts`,
        action: { kind: "fill", label: "Use in next post", prompt: `${HOOK_WORDS[hook] ? HOOK_WORDS[hook]!.replace(/^open/, "Open") : "Lead"}: ` },
      });
    const window = Array.isArray(perf.bestPostingWindows) ? perf.bestPostingWindows.find((w): w is string => typeof w === "string") : undefined;
    if (window)
      learnings.push({
        key: `window:${prof.socialAccountId}`,
        text: `Your audience on ${prof.socialAccount.displayName} is most active ${window}.`,
        confidence: label,
        strength: Math.round(conf * 100),
        basis: `${n} posts`,
        action: { kind: "link", label: "Schedule there", href: "/posts?view=calendar" },
      });
    const prefs = ((prof.humanFeedback ?? {}) as { preferences?: unknown }).preferences;
    if (Array.isArray(prefs) && prefs.length) {
      const lastIndex = prefs.length - 1;
      const last = prefs[lastIndex] as { text?: unknown; source?: unknown };
      if (typeof last.text === "string")
        learnings.push({
          key: `pref:${prof.socialAccountId}`,
          text: `From your edits on ${prof.socialAccount.displayName}: ${last.text.charAt(0).toLowerCase()}${last.text.slice(1).replace(/\.?$/, ".")}`,
          confidence: "From your edits",
          strength: Math.min(100, prefs.length * 12),
          basis: `${prefs.length} edit${prefs.length === 1 ? "" : "s"}`,
          action: opts.canEditMemory
            ? { kind: "forget", label: "Undo", accountId: prof.socialAccountId, index: lastIndex }
            : { kind: "link", label: "Open memory", href: "/memory" },
        });
    }
  }

  // ---- plan
  const items = planItems(plan?.items);
  const todayIso = today.toISOString().slice(0, 10);
  const nextIndex = items.findIndex((i) => !i.runId && typeof i.date === "string" && i.date.slice(0, 10) >= todayIso);
  const nextItem = nextIndex >= 0 ? items[nextIndex]! : null;

  return {
    week,
    upcoming,
    attention,
    inbox: conversations.map((c) => ({
      conversationId: c.id,
      name: c.contact.name || c.contact.phone,
      preview: c.lastMessagePreview ?? "",
      unread: c.unreadCount,
      at: c.lastMessageAt?.toISOString() ?? null,
      suggestion: c.messages.length > 0,
    })),
    setup: [
      { key: "account", label: "Connect a social account", done: accounts.some((a) => a.status === "CONNECTED"), href: "/accounts" },
      { key: "ai", label: "Add an AI provider key", done: opts.hasAiProvider, href: "/settings?tab=ai" },
      { key: "brand", label: "Set your brand voice", done: brands > 0, href: "/settings?tab=brand" },
      { key: "first_approval", label: "Approve your first post", done: approvals > 0, href: "/home#waiting" },
      { key: "plan", label: "Create a monthly plan", done: plan !== null, href: "/plan" },
      { key: "stories", label: "Add 3 stories to the story bank", done: stories >= 3, href: "/memory" },
    ],
    plan: plan
      ? {
          planId: plan.id,
          name: plan.name || plan.theme,
          started: items.filter((i) => Boolean(i.runId)).length,
          total: items.length,
          daysLeft: Math.max(0, Math.ceil((plan.startDate.getTime() + plan.days * DAY_MS - now) / DAY_MS)),
          next: nextItem
            ? {
                index: nextIndex,
                date: String(nextItem.date),
                platform: typeof nextItem.platform === "string" ? nextItem.platform : "LINKEDIN",
                title: typeof nextItem.title === "string" ? nextItem.title : typeof nextItem.idea === "string" ? nextItem.idea : "Next idea",
              }
            : null,
        }
      : null,
    results,
    learnings: learnings.slice(0, 3),
    awaitingCount: awaiting.length,
  };
}

function platformLabel(platform: string): string {
  return platformName(platform);
}

// ---------------------------------------------------------------------------
// Detailed view: activity, queues, spend
// ---------------------------------------------------------------------------

/** The last few things that happened anywhere in the organization, newest first. */
export async function loadActivity(organizationId: string, limit = 12): Promise<ActivityEntry[]> {
  const since = new Date(Date.now() - 2 * DAY_MS);
  const [events, jobs, audits] = await Promise.all([
    prisma.agentRunEvent.findMany({
      where: { run: { organizationId }, createdAt: { gte: since }, status: { in: ["SUCCEEDED", "FAILED"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, step: true, status: true, provider: true, model: true, latencyMs: true, error: true, createdAt: true, runId: true },
    }),
    prisma.publishJob.findMany({
      where: { postVariant: { post: { organizationId } }, updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, status: true, attemptCount: true, lastError: true, updatedAt: true, postVariant: { select: { platform: true } } },
    }),
    prisma.auditLog.findMany({
      where: { organizationId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, action: true, resourceType: true, createdAt: true },
    }),
  ]);
  const entries: ActivityEntry[] = [
    ...events.map((e) => ({
      key: `e:${e.id}`,
      at: e.createdAt.toISOString(),
      kind: "council" as const,
      text: [e.step, e.status, e.provider && e.model ? `${e.provider.toLowerCase()}::${e.model}` : null, e.latencyMs ? `${(e.latencyMs / 1000).toFixed(1)} s` : null, e.error?.slice(0, 60), `run ${e.runId.slice(0, 7)}`]
        .filter(Boolean)
        .join(" · "),
      error: e.status === "FAILED",
    })),
    ...jobs.map((j) => ({
      key: `j:${j.id}`,
      at: j.updatedAt.toISOString(),
      kind: "publish" as const,
      text: [`PublishJob ${j.id.slice(0, 8)} ${j.status}`, platformLabel(j.postVariant.platform), j.lastError?.slice(0, 60), j.attemptCount > 1 ? `attempt ${j.attemptCount}` : null]
        .filter(Boolean)
        .join(" · "),
      error: j.status === "FAILED",
    })),
    ...audits.map((a) => ({
      key: `a:${a.id}`,
      at: a.createdAt.toISOString(),
      kind: (a.action.startsWith("whatsapp") ? "whatsapp" : a.action.startsWith("memory") ? "learning" : a.action.startsWith("webhook") ? "webhook" : "audit") as ActivityKind,
      text: `${a.action} · ${a.resourceType}`,
      error: false,
    })),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Work in flight for this organization only (the shared queues are not tenant-scoped, so they are counted from the database). */
export async function loadQueues(organizationId: string): Promise<QueueRow[]> {
  const [running, queued, pubActive, pubWaiting, pubFailed] = await Promise.all([
    prisma.agentRun.count({ where: { organizationId, status: { in: [...AGENT_PIPELINE] } } }),
    prisma.agentRun.count({ where: { organizationId, status: "QUEUED" } }),
    prisma.publishJob.count({ where: { postVariant: { post: { organizationId } }, status: "RUNNING" } }).catch(() => 0),
    prisma.publishJob.count({ where: { postVariant: { post: { organizationId } }, status: { in: ["PENDING", "QUEUED"] } } }).catch(() => 0),
    prisma.publishJob.count({ where: { postVariant: { post: { organizationId } }, status: "FAILED", updatedAt: { gte: new Date(Date.now() - 7 * DAY_MS) } } }).catch(() => 0),
  ]);
  return [
    { name: "council", active: running, waiting: queued, waitingLabel: `${queued} waiting`, bad: false },
    { name: "publish", active: pubActive, waiting: pubWaiting, waitingLabel: `${pubWaiting} scheduled`, bad: false },
    { name: "failed jobs", active: 0, waiting: pubFailed, waitingLabel: pubFailed ? `${pubFailed} need a look` : "none", bad: pubFailed > 0 },
  ];
}

const STAGE_LABEL: Record<string, string> = {
  research: "Research",
  strategy: "Angles",
  drafting: "Writing",
  review: "Review",
  judge: "Judge",
  adapt: "Adapt + image",
};

/** Where this month's AI spend went, by stage, plus today's model calls. */
export async function loadSpend(organizationId: string, timeZone: string): Promise<SpendBreakdown> {
  const monthStart = new Date(startOfDayIn(timeZone).getTime());
  monthStart.setUTCDate(1);
  const [month, today] = await Promise.all([
    prisma.agentRunEvent.findMany({
      where: { run: { organizationId }, createdAt: { gte: monthStart }, costCents: { gt: 0 } },
      select: { step: true, costCents: true },
    }),
    prisma.agentRunEvent.groupBy({
      by: ["model"],
      where: { run: { organizationId }, createdAt: { gte: new Date(Date.now() - DAY_MS) }, model: { not: null }, status: { in: ["SUCCEEDED", "FAILED"] } },
      _count: { _all: true },
      _sum: { costCents: true },
    }),
  ]);
  const byStage = new Map<string, number>();
  for (const e of month) {
    const key = stageOfStep(e.step);
    if (!key || !STAGE_LABEL[key]) continue;
    byStage.set(key, (byStage.get(key) ?? 0) + e.costCents);
  }
  return {
    stages: Object.entries(STAGE_LABEL).map(([k, label]) => ({ label, cents: byStage.get(k) ?? 0 })),
    models: today
      .map((m) => ({ model: m.model ?? "", calls: m._count._all, cents: m._sum.costCents ?? 0 }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 5),
  };
}

/** Typical time from start to "ready for you" over recent runs, for the "about N minutes left" line. */
export async function typicalRunMs(organizationId: string): Promise<number | null> {
  const runs = await prisma.agentRun.findMany({
    where: { organizationId, startedAt: { not: null }, status: { in: ["AWAITING_APPROVAL", "APPROVED", "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { startedAt: true, events: { where: { step: "notify" }, take: 1, select: { createdAt: true } }, updatedAt: true },
  });
  const spans = runs
    .map((r) => ((r.events[0]?.createdAt ?? r.updatedAt).getTime() - (r.startedAt?.getTime() ?? 0)))
    .filter((ms) => ms > 0 && ms < 2 * 3600_000);
  return spans.length >= 3 ? median(spans) : null;
}


/** Average spend per campaign over the last 30 days, for the composer's estimate. */
export async function averageRunCents(organizationId: string): Promise<number | null> {
  const agg = await prisma.agentRun.aggregate({
    where: { organizationId, createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) }, spentCents: { gt: 0 } },
    _avg: { spentCents: true },
  });
  return agg._avg.spentCents ?? null;
}
