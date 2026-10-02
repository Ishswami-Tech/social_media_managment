import Link from "next/link";
import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { organizationSummary, resultsBreakdown } from "@/lib/services/analytics";
import { PLATFORM_LABELS } from "@/lib/providers";
import { cn, formatDate } from "@/lib/utils";
import { featureEnabled } from "@/lib/flags";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DeletePostButton } from "@/components/forms/delete-post-button";
import { RankedBars, TimeBars } from "@/components/app/bar-chart";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Results" };

/** Windows the page offers. Anything else in the query string falls back to 30. */
const DAY_RANGES = [7, 30, 90];

/** Builds a filter URL, leaving defaults out so the plain page keeps a clean address. */
function query({ days, account }: { days: number; account?: string | undefined }): string {
  const q = new URLSearchParams();
  if (account) q.set("account", account);
  if (days !== 30) q.set("days", String(days));
  const s = q.toString();
  return s ? `/analytics?${s}` : "/analytics";
}

/** A filter chip that keeps the rest of the query string intact. */
function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-[13px] whitespace-nowrap transition-colors",
        active ? "border-transparent bg-primary text-primary-foreground" : "border-border hover:bg-accent",
      )}
    >
      {children}
    </Link>
  );
}

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

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; days?: string }>;
}) {
  const ctx = await requireCapability("analytics:view");
  const params = await searchParams;
  const days = DAY_RANGES.includes(Number(params.days)) ? Number(params.days) : 30;
  const accounts = await prisma.socialAccount.findMany({
    where: { organizationId: ctx.organization.id },
    select: { id: true, displayName: true, platform: true },
    orderBy: { displayName: "asc" },
  });
  // An account id from the query string is only honoured if it is this org's.
  const accountId = accounts.some((a) => a.id === params.account) ? params.account : undefined;

  const [summary, recent, breakdown] = await Promise.all([
    organizationSummary(ctx.organization.id),
    prisma.postVariant.findMany({
      where: {
        post: { organizationId: ctx.organization.id },
        status: "PUBLISHED",
        ...(accountId ? { socialAccountId: accountId } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: 20,
      include: {
        post: { select: { id: true, title: true, masterText: true } },
        socialAccount: { select: { displayName: true } },
        snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      },
    }),
    resultsBreakdown(ctx.organization.id, { days, socialAccountId: accountId }),
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
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2">
        <nav aria-label="Filter by account" className="flex flex-wrap items-center gap-1.5">
          <FilterLink href={query({ days })} active={!accountId}>
            All accounts
          </FilterLink>
          {accounts.map((a) => (
            <FilterLink key={a.id} href={query({ days, account: a.id })} active={accountId === a.id}>
              <span className="flex items-center gap-1.5">
                <PlatformIcon platform={a.platform} className="size-3.5" /> {a.displayName}
              </span>
            </FilterLink>
          ))}
        </nav>
        <nav aria-label="Time range" className="flex items-center gap-1.5">
          {DAY_RANGES.map((d) => (
            <FilterLink key={d} href={query({ days: d, account: accountId })} active={days === d}>
              {d} days
            </FilterLink>
          ))}
        </nav>
      </div>
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
            <CardTitle>Reactions over time</CardTitle>
            <CardDescription>
              {breakdown.totals.published} published in the last {days} days
              {breakdown.totals.measured < breakdown.totals.published &&
                ` · ${breakdown.totals.published - breakdown.totals.measured} with no figures from the platform yet`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimeBars
              bars={breakdown.buckets.map((b) => ({
                label: b.label,
                full: b.full,
                value: b.reactions,
                secondary: b.published,
              }))}
              valueLabel="reactions"
              secondaryLabel="posts"
              empty={`Nothing published in the last ${days} days.`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>By account</CardTitle>
            <CardDescription>Reactions earned over the same window</CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              valueLabel="reactions"
              empty="No posts from these accounts yet."
              bars={breakdown.accounts.map((a) => ({
                key: a.socialAccountId,
                label: a.displayName,
                value: a.reactions,
                note: `${a.published} ${a.published === 1 ? "post" : "posts"}`,
                icon: <PlatformIcon platform={a.platform} className="size-4 shrink-0" />,
              }))}
            />
          </CardContent>
        </Card>
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
        </div>
      </div>
    </>
  );
}
