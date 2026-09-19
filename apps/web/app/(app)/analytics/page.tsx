import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { organizationSummary } from "@/lib/services/analytics";
import { PLATFORM_LABELS } from "@/lib/providers";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Analytics" };

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

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
  const e = summary.engagement30d;
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Publishing outcomes, normalised engagement and AI spend for the last 30 days."
      />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Published" value={summary.published30d} />
        <StatCard title="Failed jobs" value={summary.posts.FAILED ?? 0} />
        <StatCard title="Impressions" value={e.impressions.toLocaleString()} hint="from provider snapshots" />
        <StatCard title="Reach" value={e.reach.toLocaleString()} />
        <StatCard
          title="Engagements"
          value={(e.likes + e.comments + e.shares).toLocaleString()}
          hint="likes + comments + shares"
        />
        <StatCard
          title="AI spend"
          value={`$${summary.ai.cost.toFixed(2)}`}
          hint={`${summary.ai.inputTokens + summary.ai.outputTokens} tokens`}
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
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
                  <TableHead className="text-right">Eng.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
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
                        {m.likes !== undefined ? (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) : "—"}
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
