import Link from "next/link";
import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { listRuns } from "@/lib/agent/runs";
import { listPosts } from "@/lib/services/posts";
import { formatDate, truncate } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { ApprovalCard, type ApprovalAccount } from "@/components/home/approval-card";
import { CreateBox } from "@/components/home/create-box";
import { IN_PROGRESS_STATUSES, statusLabel } from "@/components/home/labels";
import { RefreshTimer } from "@/components/home/refresh-timer";

export const metadata = { title: "Home" };

const MAX_CARDS = 5;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ href, children, aside }: { href: string; children: React.ReactNode; aside: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent"
    >
      <span className="min-w-0 truncate">{children}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{aside}</span>
    </Link>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const ctx = await requireOrg();
  const { forbidden } = await searchParams;
  const organizationId = ctx.organization.id;

  const [accounts, awaiting, working, scheduled, queued, published] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId, status: "CONNECTED" },
      select: { id: true, platform: true, displayName: true },
      orderBy: [{ platform: "asc" }, { displayName: "asc" }],
    }),
    listRuns(ctx, { status: "AWAITING_APPROVAL", page: 1, pageSize: MAX_CARDS }),
    prisma.agentRun.findMany({
      where: { organizationId, status: { in: [...IN_PROGRESS_STATUSES] } },
      select: { id: true, topic: true, status: true },
      orderBy: { createdAt: "desc" },
      take: MAX_CARDS,
    }),
    listPosts(ctx, { status: "SCHEDULED", page: 1, pageSize: MAX_CARDS }),
    listPosts(ctx, { status: "QUEUED", page: 1, pageSize: MAX_CARDS }),
    listPosts(ctx, { status: "PUBLISHED", page: 1, pageSize: MAX_CARDS }),
  ]);

  // The list query stays lean, so the texts people read are fetched separately.
  const runIds = awaiting.items.map((r) => r.id);
  const pending = runIds.length
    ? await prisma.agentRunAccount.findMany({
        where: { runId: { in: runIds }, decision: "PENDING", run: { organizationId } },
        select: {
          id: true,
          runId: true,
          platform: true,
          finalText: true,
          editedText: true,
          socialAccount: { select: { displayName: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const isAdmin = ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.actor.isSuperAdmin === true;
  const canApprove = ctx.can("content:approve");

  const approvals = awaiting.items
    .map((run) => {
      const forRun: ApprovalAccount[] = pending
        .filter((a) => a.runId === run.id && (a.editedText ?? a.finalText))
        .map((a) => ({
          id: a.id,
          platform: a.platform,
          displayName: a.socialAccount.displayName,
          text: a.editedText ?? a.finalText ?? "",
        }));
      return {
        id: run.id,
        topic: run.topic,
        accounts: forRun,
        canDecide: canApprove && (run.createdById !== ctx.user.id || isAdmin),
      };
    })
    .filter((r) => r.accounts.length > 0);

  const upcoming = [...scheduled.items, ...queued.items]
    .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))
    .slice(0, MAX_CARDS);

  return (
    <div className="mx-auto grid max-w-3xl gap-10">
      <RefreshTimer enabled={working.length > 0} />

      {forbidden && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          That page is not available to your role. Ask someone who owns this workspace.
        </p>
      )}

      {ctx.can("ai:generate") ? (
        <CreateBox accounts={accounts} canWriteYourself={ctx.can("content:create")} />
      ) : (
        <section className="grid gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">What do you want to post about?</h2>
          {ctx.can("content:create") ? (
            <Link href="/create" className="text-sm underline underline-offset-4">
              Write a post
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Your role can read posts but not write them.</p>
          )}
        </section>
      )}

      <Section title="Needs your approval">
        {approvals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing waiting on you right now.</p>
        ) : (
          <div className="grid gap-3">
            {approvals.map((r) => (
              <ApprovalCard key={r.id} runId={r.id} topic={r.topic} accounts={r.accounts} canDecide={r.canDecide} />
            ))}
          </div>
        )}
      </Section>

      {working.length > 0 && (
        <Section title="In progress">
          <div className="grid">
            {working.map((r) => (
              <Row key={r.id} href={`/review/${r.id}`} aside={statusLabel(r.status)}>
                {truncate(r.topic, 70)}
              </Row>
            ))}
          </div>
        </Section>
      )}

      <Section title="Scheduled">
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>
        ) : (
          <div className="grid">
            {upcoming.map((p) => (
              <Row
                key={p.id}
                href={`/posts/${p.id}`}
                aside={formatDate(p.scheduledAt, { dateStyle: "medium", timeStyle: "short" }, p.timezone)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex -space-x-1">
                    {[...new Set(p.variants.map((v) => v.platform))].map((pl) => (
                      <PlatformIcon key={pl} platform={pl} className="ring-2 ring-background" />
                    ))}
                  </span>
                  <span className="truncate">{p.title || truncate(p.masterText, 60)}</span>
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recently published">
        {published.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing published yet.</p>
        ) : (
          <div className="grid">
            {published.items.map((p) => (
              <Row key={p.id} href={`/posts/${p.id}`} aside={formatDate(p.publishedAt, { dateStyle: "medium" })}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex -space-x-1">
                    {[...new Set(p.variants.map((v) => v.platform))].map((pl) => (
                      <PlatformIcon key={pl} platform={pl} className="ring-2 ring-background" />
                    ))}
                  </span>
                  <span className="truncate">{p.title || truncate(p.masterText, 60)}</span>
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
