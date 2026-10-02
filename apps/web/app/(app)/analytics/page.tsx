import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { organizationSummary } from "@/lib/services/analytics";
import { PLATFORM_LABELS } from "@/lib/providers";
import { formatDate } from "@/lib/utils";
import { featureEnabled } from "@/lib/flags";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DeletePostButton } from "@/components/forms/delete-post-button";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Results" };

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

type Summary = Awaited<ReturnType<typeof organizationSummary>>;

/** LinkedIn's reaction vocabulary, shortened to something a column can hold. */
const REACTION_LABELS: Record<string, string> = {
  LIKE: "like",
  PRAISE: "celebrate",
  EMPATHY: "support",
  INTEREST: "insightful",
  APPRECIATION: "love",
  ENTERTAINMENT: "funny",
};

/** The count, and underneath it the mix when the post drew more than one kind of reaction. */
function ReactionCell({ count, raw }: { count: number; raw: unknown }) {
  const byType = (raw as { reactions?: { byType?: Record<string, number> } } | null)?.reactions?.byType;
  const kinds = Object.entries(byType ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <span className="flex flex-col items-end">
      <span>{count}</span>
      {kinds.length > 1 && (
        <span className="text-[11px] text-muted-foreground">
          {kinds.map(([type, n]) => `${n} ${REACTION_LABELS[type] ?? type.toLowerCase()}`).join(", ")}
        </span>
      )}
    </span>
  );
}

/**
 * Separates "nobody engaged" from "the platform never told us".
 *
 * A LinkedIn member token can read the reactions on its own post and nothing
 * else: impressions, reach and comments come back 403, so those fields are
 * absent from every snapshot. Printing 0 for them would be a measurement the
 * platform never made, so an unreported metric shows as an em dash and says
 * why.
 */
function describeEngagement(summary: Summary) {
  const e = summary.engagement30d;
  const seen = summary.engagementMeasured;
  const posts = summary.engagementPosts;
  const unavailable = posts === 0 ? "no snapshots yet" : "not reported for these accounts";
  const show = (value: number, measured: number) => (measured === 0 ? "—" : value.toLocaleString());
  const hint = (measured: number, whenKnown: string) =>
    measured === 0 ? unavailable : `${whenKnown} · ${measured} of ${posts} posts`;

  const engagements = e.likes + e.comments + e.shares;
  const engagementParts = [
    seen.likes > 0 ? "likes" : null,
    seen.comments > 0 ? "comments" : null,
    seen.shares > 0 ? "shares" : null,
  ].filter(Boolean);

  return {
    impressions: show(e.impressions, seen.impressions),
    impressionsHint: hint(seen.impressions, "from provider snapshots"),
    reach: show(e.reach, seen.reach),
    reachHint: hint(seen.reach, "unique viewers"),
    engagements: engagementParts.length === 0 ? "—" : engagements.toLocaleString(),
    engagementsHint: engagementParts.length === 0 ? unavailable : `${engagementParts.join(" + ")} · ${posts} posts`,
  };
}

export default async function AnalyticsPage() {
  const ctx = await requireCapability("analytics:view");
  const [summary, recent, usageByProvider] = await Promise.all([
    organizationSummary(ctx.organization.id),
    prisma.postVariant.findMany({
      where: { post: { organizationId: ctx.organization.id }, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 20,
      include: {
        post: { select: { id: true, title: true, masterText: true } },
        socialAccount: { select: { displayName: true } },
        snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      },
    }),
    prisma.aIUsage.groupBy({
      by: ["provider", "model"],
      where: { organizationId: ctx.organization.id, createdAt: { gte: daysAgo(30) } },
      _sum: { inputTokens: true, outputTokens: true, estimatedCost: true, imageCount: true },
      _count: { _all: true },
    }),
  ]);
  const reported = describeEngagement(summary);
  const canDelete = ctx.can("content:delete");
  const canPublish = ctx.can("content:publish");
  const canExport = await featureEnabled("analytics_export", ctx.organization.id);
  return (
    <>
      <PageHeader
        title="Results"
        description="Publishing outcomes, normalised engagement and AI spend for the last 30 days. Provider metrics are refreshed every 6 hours."
      >
        {canExport && (
          <Button asChild variant="outline">
            <a href="/api/analytics/export?days=30">Export CSV</a>
          </Button>
        )}
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Published" value={summary.published30d} />
        <StatCard title="Failed jobs" value={summary.posts.FAILED ?? 0} />
        <StatCard title="Impressions" value={reported.impressions} hint={reported.impressionsHint} />
        <StatCard title="Reach" value={reported.reach} hint={reported.reachHint} />
        <StatCard title="Engagements" value={reported.engagements} hint={reported.engagementsHint} />
        <StatCard
          title="AI spend"
          value={`$${summary.ai.cost.toFixed(2)}`}
          hint={`${summary.ai.inputTokens + summary.ai.outputTokens} tokens`}
        />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Recently published</CardTitle>
            <CardDescription>
              Metrics appear once the provider exposes them and the analytics worker snapshots them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Post</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="text-right">Impr.</TableHead>
                  <TableHead className="text-right">Reactions</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Nothing published yet.
                    </TableCell>
                  </TableRow>
                )}
                {recent.map((v) => {
                  const m = (v.snapshots[0]?.metrics as Record<string, number> | undefined) ?? {};
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="max-w-64 truncate">
                        {v.post.title || v.post.masterText.slice(0, 60)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <PlatformIcon platform={v.platform} /> {v.socialAccount.displayName}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(v.publishedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.impressions ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.likes === undefined ? "—" : <ReactionCell count={m.likes} raw={v.snapshots[0]?.raw} />}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="flex items-center justify-end gap-1">
                          {v.externalUrl && (
                            <Button asChild variant="ghost" size="icon" title="Open on the platform">
                              <a href={v.externalUrl} target="_blank" rel="noreferrer noopener">
                                <ExternalLink aria-hidden />
                                <span className="sr-only">Open on the platform</span>
                              </a>
                            </Button>
                          )}
                          {canDelete && (
                            <DeletePostButton
                              postId={v.post.id}
                              status={v.status}
                              canRemoveFromPlatforms={canPublish}
                              compact
                            />
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Accounts</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {summary.accounts.map((a) => (
                <div key={`${a.platform}${a.status}`} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <PlatformIcon platform={a.platform} /> {PLATFORM_LABELS[a.platform as keyof typeof PLATFORM_LABELS]}
                  </span>
                  <span className="flex items-center gap-2">
                    {a.count} <StatusBadge status={a.status} />
                  </span>
                </div>
              ))}
              {summary.accounts.length === 0 && <p className="text-muted-foreground">No accounts connected.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>AI usage by model</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {usageByProvider.map((u) => (
                <div key={`${u.provider}-${u.model}`} className="flex items-center justify-between">
                  <span>
                    <span className="block font-medium">{u.model}</span>
                    <span className="text-xs text-muted-foreground">
                      {u.provider} · {u._count._all} calls
                    </span>
                  </span>
                  <span className="tabular-nums">${(u._sum.estimatedCost ?? 0).toFixed(3)}</span>
                </div>
              ))}
              {usageByProvider.length === 0 && <p className="text-muted-foreground">No AI usage yet.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
