import { prisma } from "../db";

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
  const seen = new Set<string>();
  for (const s of recentSnapshots) {
    if (!s.postVariantId || seen.has(s.postVariantId)) continue; // latest per variant
    seen.add(s.postVariantId);
    const m = s.metrics as Record<string, number>;
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += Number(m[k] ?? 0);
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
  };
}

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
