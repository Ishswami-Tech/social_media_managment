import Link from "next/link";
import { AlertTriangle, CalendarClock, MessageSquare, Send, Sparkles } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { organizationSummary } from "@/lib/services/analytics";
import { formatDate, truncate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const ctx = await requireOrg();
  const { forbidden } = await searchParams;
  const [summary, upcoming, needsReview, failing] = await Promise.all([
    organizationSummary(ctx.organization.id),
    prisma.post.findMany({
      where: { organizationId: ctx.organization.id, status: { in: ["SCHEDULED", "QUEUED"] } },
      orderBy: { scheduledAt: "asc" },
      take: 6,
      include: { variants: { select: { platform: true } } },
    }),
    prisma.post.findMany({
      where: { organizationId: ctx.organization.id, status: "IN_REVIEW" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.socialAccount.findMany({
      where: { organizationId: ctx.organization.id, status: { in: ["EXPIRED", "ERROR"] } },
    }),
  ]);
  const totalAccounts = summary.accounts.reduce((n, a) => n + a.count, 0);

  return (
    <>
      <PageHeader title={`Hello, ${ctx.user.name.split(" ")[0]}`} description={ctx.organization.name}>
        {ctx.can("content:create") && (
          <Button asChild>
            <Link href="/create">New post</Link>
          </Button>
        )}
      </PageHeader>
      {forbidden && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>Not allowed</AlertTitle>
          <AlertDescription>
            Your role does not include the capability {forbidden}. Ask an organization admin.
          </AlertDescription>
        </Alert>
      )}
      {failing.length > 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>{failing.length} account(s) need reconnecting</AlertTitle>
          <AlertDescription>
            {failing.map((a) => a.displayName).join(", ")}.{" "}
            <Link href="/accounts" className="underline">
              Reconnect
            </Link>{" "}
            to resume publishing.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Published (30d)"
          value={summary.published30d}
          icon={Send}
          hint={`${totalAccounts} connected account(s)`}
        />
        <StatCard
          title="Scheduled"
          value={summary.scheduled}
          icon={CalendarClock}
          hint={`${summary.posts.IN_REVIEW ?? 0} awaiting review`}
        />
        <StatCard
          title="AI usage (30d)"
          value={`$${summary.ai.cost.toFixed(2)}`}
          icon={Sparkles}
          hint={`${summary.ai.calls} calls · ${summary.ai.images} images`}
        />
        <StatCard
          title="WhatsApp"
          value={summary.whatsapp.openConversations}
          icon={MessageSquare}
          hint={`${summary.whatsapp.unread} unread messages`}
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>}
            {upcoming.map((p) => (
              <Link
                key={p.id}
                href={`/posts/${p.id}`}
                className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex -space-x-1">
                    {[...new Set(p.variants.map((v) => v.platform))].map((pl) => (
                      <PlatformIcon key={pl} platform={pl} className="ring-2 ring-background" />
                    ))}
                  </span>
                  <span className="truncate">{p.title || truncate(p.masterText, 60)}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDate(p.scheduledAt, { dateStyle: "medium", timeStyle: "short" }, p.timezone)}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Awaiting review</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {needsReview.length === 0 && (
              <p className="text-sm text-muted-foreground">No posts waiting for approval.</p>
            )}
            {needsReview.map((p) => (
              <Link
                key={p.id}
                href={`/posts/${p.id}`}
                className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate">{p.title || truncate(p.masterText, 60)}</span>
                  <span className="text-xs text-muted-foreground">by {p.createdBy.name}</span>
                </span>
                <StatusBadge status={p.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
