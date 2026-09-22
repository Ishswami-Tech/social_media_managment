import Link from "next/link";
import { AGENT_RUN_STATUSES, type AgentRunStatus } from "@platform/types";
import { requireCapability } from "@/lib/session";
import { listRuns } from "@/lib/agent/runs";
import { formatDate, truncate } from "@/lib/utils";
import { formatCents } from "@/components/agent/format";
import { PageHeader } from "@/components/app/page-header";
import { PlatformIcon } from "@/components/app/platform-icon";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Campaigns" };

/** Statuses offered as quick filters; the rest stay reachable through "All". */
const FILTERS: readonly (AgentRunStatus | "ALL")[] = [
  "ALL",
  "QUEUED",
  "DRAFTING",
  "AWAITING_APPROVAL",
  "PUBLISHING",
  "COMPLETED",
  "BLOCKED",
  "FAILED",
] as const;

const PAGE_SIZE = 25;

function href(status: AgentRunStatus | undefined, page: number): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/agent?${qs}` : "/agent";
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const ctx = await requireCapability("ai:generate");
  const sp = await searchParams;
  const status = AGENT_RUN_STATUSES.includes(sp.status as AgentRunStatus) ? (sp.status as AgentRunStatus) : undefined;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { items, total, pageSize } = await listRuns(ctx, { status, page, pageSize: PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Autonomous research, drafting and review. Nothing is published without your policy allowing it."
      >
        <Button asChild>
          <Link href="/agent/new">New campaign</Link>
        </Button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f} asChild size="sm" variant={(f === "ALL" && !status) || f === status ? "default" : "outline"}>
            <Link href={f === "ALL" ? "/agent" : href(f, 1)}>{f.replaceAll("_", " ").toLowerCase()}</Link>
          </Button>
        ))}
      </div>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Accounts</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Spend</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    {status
                      ? "No campaigns match this filter."
                      : "No campaigns yet. Start one and the council will research, draft and review it for you."}
                  </TableCell>
                </TableRow>
              )}
              {items.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link href={`/agent/${run.id}`} className="font-medium hover:underline">
                      {truncate(run.topic, 70)}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{truncate(run.goal, 80)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      {run.accounts.map((a) => (
                        <span key={a.id} className="flex items-center gap-1" title={a.socialAccount.displayName}>
                          <PlatformIcon platform={a.platform} />
                        </span>
                      ))}
                      {run.accounts.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatCents(run.spentCents)} / {formatCents(run.maxCents)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(run.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button asChild variant="outline" size="sm" disabled={page <= 1}>
            <Link href={href(status, Math.max(1, page - 1))}>Previous</Link>
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button asChild variant="outline" size="sm" disabled={page >= pages}>
            <Link href={href(status, Math.min(pages, page + 1))}>Next</Link>
          </Button>
        </div>
      )}
    </>
  );
}
