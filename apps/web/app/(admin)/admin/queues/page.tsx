import Link from "next/link";
import { prisma } from "@/lib/db";
import { queues } from "@/lib/queue";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Queues & webhooks" };
export const dynamic = "force-dynamic";

export default async function AdminQueues() {
  let stats: Record<string, { waiting: number; active: number; delayed: number; failed: number; completed: number }> =
    {};
  let redisError: string | null = null;
  try {
    stats = await queues().stats();
  } catch (e) {
    redisError = (e as Error).message;
  }
  const deadLetterStats = stats["dead-letter"];
  const deadLetters = deadLetterStats ? deadLetterStats.waiting + deadLetterStats.delayed + deadLetterStats.active : 0;
  const [failedJobs, webhooks] = await Promise.all([
    prisma.publishJob.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 25,
      include: {
        postVariant: {
          select: { platform: true, postId: true, post: { select: { organization: { select: { name: true } } } } },
        },
      },
    }),
    prisma.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 25 }),
  ]);
  return (
    <>
      <PageHeader
        title="Queues, workers & webhooks"
        description="BullMQ queue depth and recent failures. Workers run as a separate process."
      />
      {redisError && <p className="mb-4 text-sm text-destructive">Redis unavailable: {redisError}</p>}
      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>Dead letters</CardTitle>
          <Link href="/admin/dead-letter" className="text-sm font-medium underline underline-offset-4">
            Inspect &amp; retry
          </Link>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums">{deadLetters}</p>
          <p className="text-sm text-muted-foreground">
            Jobs parked after exhausting their retries. They stay here until an administrator re-enqueues or discards
            them.
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
        {Object.entries(stats).map(([name, s]) => (
          <StatCard
            key={name}
            title={name}
            value={s.waiting + s.delayed}
            hint={`${s.active} active · ${s.failed} failed · ${s.completed} done`}
          />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Failed publish jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedJobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>{j.postVariant.post.organization.name}</TableCell>
                    <TableCell>{j.postVariant.platform}</TableCell>
                    <TableCell>{j.attemptCount}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{j.lastError}</TableCell>
                  </TableRow>
                ))}
                {failedJobs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      No failed jobs.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent webhook events</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>{w.provider}</TableCell>
                    <TableCell className="text-xs">{w.eventType}</TableCell>
                    <TableCell>
                      <StatusBadge status={w.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(w.receivedAt)}</TableCell>
                  </TableRow>
                ))}
                {webhooks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      No webhook events yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
