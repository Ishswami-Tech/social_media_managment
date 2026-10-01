/**
 * The small facts Home shows next to the one current post: what else waits
 * for a decision, and which models actually wrote drafts today.
 */
import { AGENT_PIPELINE, type AgentRunStatus } from "@platform/types";
import { prisma } from "@/lib/db";
import { monthlyBudgetStatus } from "@/lib/agent/budget";
import { modelLabel, providerName } from "@platform/agent-council/progress";

export interface WaitingItem {
  runId: string;
  topic: string;
  accounts: string[];
  /** Best judge score among the pending winners, 0-100, when known. */
  score: number | null;
  waitingSince: string;
  /** Who started it: the starter may not approve their own campaign unless they are an owner or admin. */
  createdById: string;
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
      accounts: {
        select: {
          decision: true,
          winnerDraftId: true,
          socialAccount: { select: { displayName: true } },
          drafts: { select: { id: true, judgeScore: true } },
        },
      },
    },
  });
  return runs.map((run) => {
    const pending = run.accounts.filter((a) => a.decision === "PENDING");
    const scores = pending
      .map((a) => a.drafts.find((d) => d.id === a.winnerDraftId)?.judgeScore)
      .filter((s): s is number => typeof s === "number");
    return {
      runId: run.id,
      topic: run.topic,
      accounts: pending.map((a) => a.socialAccount.displayName),
      score: scores.length ? Math.round(Math.max(...scores)) : null,
      waitingSince: run.updatedAt.toISOString(),
      createdById: run.createdById,
    };
  });
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
// Today: agenda, attention, setup
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const UPCOMING_STATUSES = ["SCHEDULED", "APPROVED", "QUEUED"] as const;

export interface UpcomingPost {
  postId: string;
  title: string;
  scheduledAt: string;
  platforms: string[];
}

export interface WeekDay {
  /** ISO date at local midnight on the server. */
  date: string;
  count: number;
}

export interface AttentionItem {
  kind: "failed_post" | "account" | "blocked_run";
  title: string;
  detail: string;
  href: string;
}

export interface InboxPreview {
  conversationId: string;
  name: string;
  preview: string;
  unread: number;
  at: string | null;
}

export interface SetupStep {
  key: "account" | "ai" | "brand" | "first_post" | "plan";
  label: string;
  done: boolean;
  href: string;
}

export interface PlanGlance {
  planId: string;
  name: string;
  /** Plan items dated from today on that have not been started yet. */
  remaining: number;
  /** Items already handed to the council. */
  started: number;
  total: number;
}

export interface RecentResult {
  /** The variant, not the post: one post can publish to the same platform twice. */
  variantId: string;
  postId: string;
  title: string;
  platform: string;
  publishedAt: string;
  impressions: number;
  engagements: number;
}

export interface TodayResults {
  /** Published variants in the last 30 days. */
  published: number;
  impressions: number;
  engagements: number;
  recent: RecentResult[];
}

export interface TodayAgenda {
  results: TodayResults;
  upcoming: UpcomingPost[];
  week: WeekDay[];
  attention: AttentionItem[];
  inbox: InboxPreview[];
  setup: SetupStep[];
  plan: PlanGlance | null;
}

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

function planItems(value: unknown): { date?: unknown; runId?: unknown }[] {
  return Array.isArray(value) ? value.filter((v): v is { date?: unknown; runId?: unknown } => typeof v === "object" && v !== null) : [];
}

/**
 * The right-hand side of Today, all scoped to one organization: what goes out
 * this week, what broke, who wrote in, and what is left to set up.
 */
export async function loadTodayAgenda(
  organizationId: string,
  opts: { hasAiProvider: boolean; hasWhatsApp: boolean; timeZone: string },
): Promise<TodayAgenda> {
  const today = startOfDayIn(opts.timeZone);
  const weekEnd = new Date(today.getTime() + 7 * DAY_MS);
  const [scheduled, failed, accounts, blocked, conversations, brands, runCount, plan, published] = await Promise.all([
    prisma.post.findMany({
      where: { organizationId, status: { in: [...UPCOMING_STATUSES] }, scheduledAt: { gte: new Date(), lt: weekEnd } },
      orderBy: { scheduledAt: "asc" },
      take: 50,
      select: { id: true, title: true, masterText: true, scheduledAt: true, variants: { select: { platform: true } } },
    }),
    prisma.post.findMany({
      where: { organizationId, status: { in: ["FAILED", "DISCONNECTED_ACCOUNT"] }, updatedAt: { gte: new Date(Date.now() - 7 * DAY_MS) } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, title: true, masterText: true, status: true },
    }),
    prisma.socialAccount.findMany({
      where: { organizationId },
      select: { id: true, displayName: true, platform: true, status: true },
    }),
    prisma.agentRun.findMany({
      where: { organizationId, status: { in: ["BLOCKED", "PAUSED", "FAILED"] }, updatedAt: { gte: new Date(Date.now() - 2 * DAY_MS) } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, topic: true, status: true, blockedReason: true },
    }),
    opts.hasWhatsApp
      ? prisma.conversation.findMany({
          where: { organizationId, unreadCount: { gt: 0 } },
          orderBy: { lastMessageAt: "desc" },
          take: 3,
          select: { id: true, unreadCount: true, lastMessageAt: true, lastMessagePreview: true, contact: { select: { name: true, phone: true } } },
        })
      : [],
    prisma.brand.count({ where: { organizationId } }),
    prisma.agentRun.count({ where: { organizationId } }),
    prisma.contentPlan.findFirst({
      where: { organizationId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, theme: true, items: true },
    }),
    prisma.postVariant.findMany({
      where: { post: { organizationId }, status: "PUBLISHED", publishedAt: { gte: new Date(Date.now() - 30 * DAY_MS) } },
      orderBy: { publishedAt: "desc" },
      take: 100,
      select: {
        id: true,
        postId: true,
        platform: true,
        text: true,
        publishedAt: true,
        post: { select: { title: true } },
        snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { metrics: true } },
      },
    }),
  ]);
  const num = (m: unknown, k: string): number =>
    typeof m === "object" && m !== null && typeof (m as Record<string, unknown>)[k] === "number" ? ((m as Record<string, number>)[k] ?? 0) : 0;
  const rows: RecentResult[] = published.map((v) => {
    const m = v.snapshots[0]?.metrics;
    return {
      variantId: v.id,
      postId: v.postId,
      title: v.post.title || v.text.slice(0, 80),
      platform: v.platform,
      publishedAt: (v.publishedAt ?? new Date()).toISOString(),
      impressions: num(m, "impressions"),
      engagements: num(m, "likes") + num(m, "comments") + num(m, "shares"),
    };
  });

  const week: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today.getTime() + i * DAY_MS);
    const next = day.getTime() + DAY_MS;
    return {
      date: day.toISOString(),
      count: scheduled.filter((p) => p.scheduledAt && p.scheduledAt.getTime() >= day.getTime() && p.scheduledAt.getTime() < next).length,
    };
  });

  const attention: AttentionItem[] = [
    ...accounts
      .filter((a) => a.status === "EXPIRED" || a.status === "ERROR")
      .map((a) => ({
        kind: "account" as const,
        title: `Reconnect ${a.displayName}`,
        detail: a.status === "EXPIRED" ? "Sign-in expired; posts to it will fail" : "The last sync failed",
        href: "/accounts",
      })),
    ...failed.map((p) => ({
      kind: "failed_post" as const,
      title: p.title || p.masterText.slice(0, 60),
      detail: p.status === "DISCONNECTED_ACCOUNT" ? "Account was disconnected" : "Didn't publish",
      href: `/posts/${p.id}`,
    })),
    ...blocked.map((r) => ({
      kind: "blocked_run" as const,
      title: r.topic,
      detail: r.status === "PAUSED" ? "Paused" : r.status === "FAILED" ? "The council stopped" : (r.blockedReason ?? "Blocked"),
      href: `/agent/${r.id}`,
    })),
  ];

  const items = planItems(plan?.items);
  const remaining = items.filter((i) => !i.runId && typeof i.date === "string" && Date.parse(i.date) >= today.getTime()).length;

  return {
    results: {
      published: rows.length,
      impressions: rows.reduce((sum, r) => sum + r.impressions, 0),
      engagements: rows.reduce((sum, r) => sum + r.engagements, 0),
      recent: rows.slice(0, 3),
    },
    upcoming: scheduled.slice(0, 4).map((p) => ({
      postId: p.id,
      title: p.title || p.masterText.slice(0, 80),
      scheduledAt: p.scheduledAt!.toISOString(),
      platforms: [...new Set(p.variants.map((v) => v.platform))],
    })),
    week,
    attention,
    inbox: conversations.map((c) => ({
      conversationId: c.id,
      name: c.contact.name || c.contact.phone,
      preview: c.lastMessagePreview ?? "",
      unread: c.unreadCount,
      at: c.lastMessageAt?.toISOString() ?? null,
    })),
    setup: [
      { key: "account", label: "Connect a social account", done: accounts.some((a) => a.status === "CONNECTED"), href: "/accounts" },
      { key: "ai", label: "Add an AI provider key", done: opts.hasAiProvider, href: "/settings?tab=ai" },
      { key: "brand", label: "Describe your brand voice", done: brands > 0, href: "/settings?tab=brand" },
      { key: "first_post", label: "Let the council write a post", done: runCount > 0, href: "/home#compose" },
      { key: "plan", label: "Plan a month of posts", done: plan !== null, href: "/plan" },
    ],
    plan: plan
      ? {
          planId: plan.id,
          name: plan.name || plan.theme,
          remaining,
          started: items.filter((i) => Boolean(i.runId)).length,
          total: items.length,
        }
      : null,
  };
}
