import { loadSocialCredential } from "@platform/database";
import type { NormalizedMetrics, ProviderContext } from "@platform/social-core";
import type { Prisma } from "@platform/database";
import { keyring, prisma } from "../db";
import { logger, errorInfo } from "../logger";
import { providers } from "../providers";
import { queues } from "../queue";

export async function organizationSummary(organizationId: string) {
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [accounts, postsByStatus, published30d, scheduled, aiUsage, conversationsOpen, unread, recentSnapshots] =
    await Promise.all([
      prisma.socialAccount.groupBy({ by: ["platform", "status"], where: { organizationId }, _count: { _all: true } }),
      prisma.post.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
      prisma.post.count({ where: { organizationId, status: "PUBLISHED", publishedAt: { gte: since30d } } }),
      prisma.post.count({ where: { organizationId, status: { in: ["SCHEDULED", "QUEUED"] } } }),
      prisma.aIUsage.aggregate({
        where: { organizationId, createdAt: { gte: since30d } },
        _sum: { inputTokens: true, outputTokens: true, estimatedCost: true, imageCount: true },
        _count: { _all: true },
      }),
      prisma.conversation.count({ where: { organizationId, status: "OPEN" } }),
      prisma.conversation.aggregate({ where: { organizationId }, _sum: { unreadCount: true } }),
      prisma.analyticsSnapshot.findMany({
        where: { organizationId, scope: "POST", capturedAt: { gte: since30d } },
        orderBy: { capturedAt: "desc" },
        take: 500,
        select: { metrics: true, postVariantId: true },
      }),
    ]);
  const totals = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  /**
   * How many posts actually reported each metric. A platform that does not
   * expose impressions to this kind of account leaves the field out, and
   * summing it to 0 would read as "nobody saw it" rather than "we cannot
   * know". Keeping the count lets the page tell those two apart.
   */
  const measured = { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, clicks: 0 };
  const seen = new Set<string>();
  for (const s of recentSnapshots) {
    if (!s.postVariantId || seen.has(s.postVariantId)) continue; // latest per variant
    seen.add(s.postVariantId);
    const m = s.metrics as Record<string, number | undefined>;
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
      if (m[k] === undefined || m[k] === null) continue;
      totals[k] += Number(m[k]);
      measured[k] += 1;
    }
  }
  return {
    accounts: accounts.map((a) => ({ platform: a.platform, status: a.status, count: a._count._all })),
    posts: Object.fromEntries(postsByStatus.map((p) => [p.status, p._count._all])) as Record<string, number>,
    published30d,
    scheduled,
    ai: {
      calls: aiUsage._count._all,
      inputTokens: aiUsage._sum.inputTokens ?? 0,
      outputTokens: aiUsage._sum.outputTokens ?? 0,
      images: aiUsage._sum.imageCount ?? 0,
      cost: Number((aiUsage._sum.estimatedCost ?? 0).toFixed(4)),
    },
    whatsapp: { openConversations: conversationsOpen, unread: unread._sum.unreadCount ?? 0 },
    engagement30d: totals,
    /** Posts that reported each metric, out of `engagementPosts`. Zero means the platform never told us. */
    engagementMeasured: measured,
    engagementPosts: seen.size,
  };
}

// ---------------------------------------------------------------------------
// Results over time, for the charts
// ---------------------------------------------------------------------------

/** One column of the chart: a stretch of days, and what went out in it. */
export interface ResultsBucket {
  /** Short axis label, e.g. "15 Sep". */
  label: string;
  /** Full description for a screen reader and the title attribute. */
  full: string;
  published: number;
  reactions: number;
}

/** One account's share of the period, so accounts can be compared side by side. */
export interface AccountTotals {
  socialAccountId: string;
  displayName: string;
  platform: string;
  published: number;
  reactions: number;
  /** Posts whose reactions the platform actually reported; the rest are unknown, not zero. */
  measured: number;
}

export interface ResultsBreakdown {
  buckets: ResultsBucket[];
  accounts: AccountTotals[];
  totals: { published: number; reactions: number; measured: number };
}

/** Daily columns read well for a fortnight; beyond that they turn into a comb, so group by week. */
function bucketSize(days: number): { ms: number; weekly: boolean } {
  return days <= 14 ? { ms: 86_400_000, weekly: false } : { ms: 7 * 86_400_000, weekly: true };
}

/**
 * Publishing and engagement over a window, bucketed for a bar chart and
 * totalled per account.
 *
 * Reactions are attributed to the day a post went out rather than the day
 * they were captured: the question a chart answers is "how did what we
 * published on Tuesday do", not "when did the worker last run".
 */
export async function resultsBreakdown(
  organizationId: string,
  opts: { days: number; socialAccountId?: string | undefined },
): Promise<ResultsBreakdown> {
  const { days } = opts;
  const since = new Date(Date.now() - days * 86_400_000);
  const variants = await prisma.postVariant.findMany({
    where: {
      post: { organizationId },
      status: "PUBLISHED",
      publishedAt: { gte: since },
      ...(opts.socialAccountId ? { socialAccountId: opts.socialAccountId } : {}),
    },
    select: {
      publishedAt: true,
      socialAccountId: true,
      platform: true,
      socialAccount: { select: { displayName: true } },
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { metrics: true } },
    },
  });

  const { ms, weekly } = bucketSize(days);
  const now = Date.now();
  const count = Math.max(1, Math.ceil((days * 86_400_000) / ms));
  const start = now - count * ms;
  const buckets: ResultsBucket[] = Array.from({ length: count }, (_, i) => {
    const from = new Date(start + i * ms);
    const to = new Date(start + (i + 1) * ms - 1);
    return {
      label: shortDate(from),
      full: weekly ? `${shortDate(from)} – ${shortDate(to)}` : shortDate(from),
      published: 0,
      reactions: 0,
    };
  });

  const byAccount = new Map<string, AccountTotals>();
  const totals = { published: 0, reactions: 0, measured: 0 };

  for (const v of variants) {
    if (!v.publishedAt) continue;
    const metrics = v.snapshots[0]?.metrics as { likes?: number } | undefined;
    const reactions = metrics?.likes;

    const index = Math.min(count - 1, Math.max(0, Math.floor((v.publishedAt.getTime() - start) / ms)));
    const bucket = buckets[index];
    if (bucket) {
      bucket.published += 1;
      bucket.reactions += reactions ?? 0;
    }

    const row = byAccount.get(v.socialAccountId) ?? {
      socialAccountId: v.socialAccountId,
      displayName: v.socialAccount.displayName,
      platform: v.platform as string,
      published: 0,
      reactions: 0,
      measured: 0,
    };
    row.published += 1;
    if (reactions !== undefined) {
      row.reactions += reactions;
      row.measured += 1;
    }
    byAccount.set(v.socialAccountId, row);

    totals.published += 1;
    if (reactions !== undefined) {
      totals.reactions += reactions;
      totals.measured += 1;
    }
  }

  return {
    buckets,
    accounts: [...byAccount.values()].sort((a, b) => b.reactions - a.reactions || b.published - a.published),
    totals,
  };
}

const shortDate = (d: Date) => `${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]}`;

export async function platformSummary() {
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [organizations, users, accounts, posts, published30d, failed, webhooksFailed, aiCost, aiByProvider] =
    await Promise.all([
      prisma.organization.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.user.count(),
      prisma.socialAccount.groupBy({ by: ["platform"], _count: { _all: true } }),
      prisma.post.count(),
      prisma.post.count({ where: { status: "PUBLISHED", publishedAt: { gte: since30d } } }),
      prisma.publishJob.count({ where: { status: "FAILED", updatedAt: { gte: since30d } } }),
      prisma.webhookEvent.count({ where: { status: "FAILED" } }),
      prisma.aIUsage.aggregate({
        where: { createdAt: { gte: since30d } },
        _sum: { estimatedCost: true },
        _count: { _all: true },
      }),
      prisma.aIUsage.groupBy({
        by: ["provider"],
        where: { createdAt: { gte: since30d } },
        _sum: { inputTokens: true, outputTokens: true, estimatedCost: true },
        _count: { _all: true },
      }),
    ]);
  return {
    organizations: Object.fromEntries(organizations.map((o) => [o.status, o._count._all])) as Record<string, number>,
    users,
    accounts: accounts.map((a) => ({ platform: a.platform, count: a._count._all })),
    posts,
    published30d,
    failedJobs30d: failed,
    webhooksFailed,
    ai: {
      calls: aiCost._count._all,
      cost: Number((aiCost._sum.estimatedCost ?? 0).toFixed(2)),
      byProvider: aiByProvider.map((p) => ({
        provider: p.provider,
        calls: p._count._all,
        inputTokens: p._sum.inputTokens ?? 0,
        outputTokens: p._sum.outputTokens ?? 0,
        cost: Number((p._sum.estimatedCost ?? 0).toFixed(2)),
      })),
    },
  };
}

// ---- collection (Phase 7) ----

async function contextFor(account: {
  id: string;
  platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "X" | "TIKTOK" | "YOUTUBE" | "THREADS" | "PINTEREST";
  externalAccountId: string;
  accountType: ProviderContext["accountType"];
  metadata: unknown;
}): Promise<ProviderContext | null> {
  const credential = await loadSocialCredential(prisma, keyring(), account.id);
  if (!credential) return null;
  return {
    credential,
    externalAccountId: account.externalAccountId,
    accountType: account.accountType,
    metadata: (account.metadata as Record<string, unknown>) ?? undefined,
  };
}

/** Worker: snapshot metrics for one published variant. */
export async function collectPostMetrics(postVariantId: string): Promise<void> {
  const variant = await prisma.postVariant.findUnique({
    where: { id: postVariantId },
    include: { socialAccount: true, post: { select: { organizationId: true } } },
  });
  if (!variant?.externalPostId || variant.status !== "PUBLISHED" || variant.socialAccount.status !== "CONNECTED")
    return;
  if (!providers().has(variant.platform)) return;
  const provider = providers().get(variant.platform);
  if (!provider.getPostMetrics) return;
  const ctx = await contextFor(variant.socialAccount);
  if (!ctx) return;
  const result = await provider.getPostMetrics(variant.externalPostId, ctx);
  if (!result) return;
  await prisma.analyticsSnapshot.create({
    data: {
      organizationId: variant.post.organizationId,
      socialAccountId: variant.socialAccountId,
      postVariantId: variant.id,
      scope: "POST",
      capturedAt: result.capturedAt,
      metrics: compact(result.metrics),
      raw: (result.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Worker: snapshot account-level metrics (followers etc.). */
export async function collectAccountMetrics(socialAccountId: string): Promise<void> {
  const account = await prisma.socialAccount.findUnique({ where: { id: socialAccountId } });
  if (!account || account.status !== "CONNECTED" || !providers().has(account.platform)) return;
  const provider = providers().get(account.platform);
  if (!provider.getAccountMetrics) return;
  const ctx = await contextFor(account);
  if (!ctx) return;
  const result = await provider.getAccountMetrics(ctx);
  if (!result) return;
  await prisma.analyticsSnapshot.create({
    data: {
      organizationId: account.organizationId,
      socialAccountId: account.id,
      scope: "ACCOUNT",
      capturedAt: result.capturedAt,
      metrics: compact(result.metrics),
      raw: (result.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

function compact(m: NormalizedMetrics): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(m).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
  ) as Prisma.InputJsonObject;
}

/** Maintenance: fan out one analytics job per connected account and per post published in the last 30 days. */
export async function scheduleAnalyticsCollection(): Promise<{ accounts: number; posts: number }> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [accounts, variants] = await Promise.all([
    prisma.socialAccount.findMany({ where: { status: "CONNECTED" }, select: { id: true, organizationId: true } }),
    prisma.postVariant.findMany({
      where: { status: "PUBLISHED", publishedAt: { gte: since }, externalPostId: { not: null } },
      select: { id: true, post: { select: { organizationId: true } } },
    }),
  ]);
  const stamp = new Date().toISOString().slice(0, 13); // one job per account/post per hour at most
  for (const a of accounts) {
    try {
      await queues().enqueue("analytics", `analytics:account:${a.id}:${stamp}`, {
        organizationId: a.organizationId,
        socialAccountId: a.id,
      });
    } catch (e) {
      logger.warn("analytics enqueue failed", { socialAccountId: a.id, ...errorInfo(e) });
    }
  }
  for (const v of variants) {
    try {
      await queues().enqueue("analytics", `analytics:post:${v.id}:${stamp}`, {
        organizationId: v.post.organizationId,
        postVariantId: v.id,
      });
    } catch (e) {
      logger.warn("analytics enqueue failed", { postVariantId: v.id, ...errorInfo(e) });
    }
  }
  return { accounts: accounts.length, posts: variants.length };
}

// ---- export ----

const CSV_COLUMNS = [
  "postId",
  "title",
  "platform",
  "account",
  "publishedAt",
  "externalUrl",
  "impressions",
  "reach",
  "likes",
  "comments",
  "shares",
  "clicks",
  "saves",
  "capturedAt",
] as const;

export function toCsv(rows: Record<string, unknown>[], columns: readonly string[] = CSV_COLUMNS): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Neutralise spreadsheet formula injection and quote as needed.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** Published posts with their latest metrics snapshot for the organization. */
export async function exportRows(organizationId: string, since: Date): Promise<Record<string, unknown>[]> {
  const variants = await prisma.postVariant.findMany({
    where: { post: { organizationId }, status: "PUBLISHED", publishedAt: { gte: since } },
    orderBy: { publishedAt: "desc" },
    include: {
      post: { select: { id: true, title: true, masterText: true } },
      socialAccount: { select: { displayName: true } },
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });
  return variants.map((v) => {
    const m = (v.snapshots[0]?.metrics as Record<string, number> | undefined) ?? {};
    return {
      postId: v.post.id,
      title: v.post.title || v.post.masterText.slice(0, 80),
      platform: v.platform,
      account: v.socialAccount.displayName,
      publishedAt: v.publishedAt,
      externalUrl: v.externalUrl,
      impressions: m.impressions,
      reach: m.reach,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      clicks: m.clicks,
      saves: m.saves,
      capturedAt: v.snapshots[0]?.capturedAt,
    };
  });
}
