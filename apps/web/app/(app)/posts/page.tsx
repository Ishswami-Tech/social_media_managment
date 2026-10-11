import Link from "next/link";
import type { PostStatus } from "@platform/types";
import { requireOrg, type OrgContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { listPosts } from "@/lib/services/posts";
import { cn, formatDate, truncate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { CalendarView } from "@/components/posts/calendar-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeletePostButton } from "@/components/forms/delete-post-button";
import { calendarMonth } from "@/lib/calendar";

export const metadata = { title: "Posts" };

/** Plain-language groups over the internal post statuses. Drafts only show under "All". */
const FILTERS = [
  { key: "all", label: "All", statuses: undefined },
  { key: "review", label: "Needs review", statuses: ["IN_REVIEW", "APPROVED"] },
  { key: "scheduled", label: "Scheduled", statuses: ["SCHEDULED", "QUEUED", "PUBLISHING"] },
  { key: "published", label: "Published", statuses: ["PUBLISHED"] },
  { key: "failed", label: "Failed", statuses: ["FAILED", "DISCONNECTED_ACCOUNT"] },
] as const satisfies readonly { key: string; label: string; statuses?: readonly PostStatus[] }[];

type FilterKey = (typeof FILTERS)[number]["key"];

function resolveFilter(raw: string | undefined): (typeof FILTERS)[number] {
  return FILTERS.find((f) => f.key === raw) ?? FILTERS[0];
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; filter?: string; page?: string; m?: string }>;
}) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const isCalendar = sp.view === "calendar";

  return (
    <>
      <PageHeader title="Posts" description="Everything you have drafted, scheduled and published.">
        <div className="inline-flex rounded-lg border p-0.5">
          <Link
            href="/posts"
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium",
              isCalendar ? "text-muted-foreground hover:text-foreground" : "bg-muted",
            )}
          >
            List
          </Link>
          <Link
            href="/posts?view=calendar"
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium",
              isCalendar ? "bg-muted" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Calendar
          </Link>
        </div>
        {ctx.can("content:create") && (
          <Button asChild variant="outline">
            <Link href="/posts/import">Import CSV</Link>
          </Button>
        )}
        {ctx.can("content:create") && (
          <Button asChild>
            <Link href="/create">New post</Link>
          </Button>
        )}
      </PageHeader>
      {isCalendar ? <CalendarMonth ctx={ctx} month={sp.m} /> : <PostList ctx={ctx} filter={sp.filter} page={sp.page} />}
    </>
  );
}

async function CalendarMonth({ ctx, month: monthParam }: { ctx: OrgContext; month: string | undefined }) {
  const { year, month } = calendarMonth(monthParam, ctx.settings.timezone);
  const start = new Date(Date.UTC(year, month, -7));
  const end = new Date(Date.UTC(year, month + 1, 9));
  const canSeeAll = ctx.can("content:edit_any") || ctx.can("content:approve");
  const posts = await prisma.post.findMany({
    where: {
      organizationId: ctx.organization.id,
      ...(!canSeeAll ? { createdById: ctx.user.id } : {}),
      status: { notIn: ["CANCELLED", "DELETED"] },
      OR: [{ scheduledAt: { gte: start, lt: end } }, { publishedAt: { gte: start, lt: end } }],
    },
    select: {
      id: true,
      title: true,
      masterText: true,
      scheduledAt: true,
      publishedAt: true,
      createdAt: true,
      status: true,
      createdById: true,
      variants: { select: { platform: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });
  return (
    <CalendarView
      key={`${year}-${month}`}
      posts={posts.map((post) => ({
        ...post,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        publishedAt: post.publishedAt?.toISOString() ?? null,
        createdAt: post.createdAt.toISOString(),
        canReschedule:
          ctx.can("content:publish") &&
          (post.createdById === ctx.user.id || ctx.can("content:edit_any")) &&
          ["SCHEDULED", "QUEUED"].includes(post.status),
      }))}
      year={year}
      month={month}
      timezone={ctx.settings.timezone}
      canCreate={ctx.can("content:create")}
    />
  );
}

async function PostList({
  ctx,
  filter: filterParam,
  page: pageParam,
}: {
  ctx: OrgContext;
  filter?: string;
  page?: string;
}) {
  const filter = resolveFilter(filterParam);
  const page = Math.max(1, Number(pageParam ?? 1) || 1);
  const canSeeAll = ctx.can("content:edit_any") || ctx.can("content:approve");
  const { items, total, pageSize } = await listPosts(ctx, {
    status: filter.statuses ? [...filter.statuses] : undefined,
    page,
    pageSize: 25,
    mine: !canSeeAll,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const canDeleteAny = ctx.can("content:delete");
  const canPublish = ctx.can("content:publish");
  const pageHref = (n: number, key: FilterKey) => `/posts?${key === "all" ? "" : `filter=${key}&`}page=${n}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.key} asChild size="sm" variant={f.key === filter.key ? "default" : "outline"}>
            <Link href={f.key === "all" ? "/posts" : `/posts?filter=${f.key}`}>{f.label}</Link>
          </Button>
        ))}
      </div>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Post</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Author</TableHead>
                <TableHead className="w-10 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    Nothing here yet.
                  </TableCell>
                </TableRow>
              )}
              {items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/posts/${p.id}`} className="font-medium hover:underline">
                      {p.title || truncate(p.masterText, 70)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="flex -space-x-1">
                      {p.variants.map((v) => (
                        <PlatformIcon key={v.id} platform={v.platform} className="ring-2 ring-background" />
                      ))}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(p.scheduledAt, { dateStyle: "medium", timeStyle: "short" }, p.timezone)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.createdBy.name}</TableCell>
                  <TableCell className="text-right">
                    {(canDeleteAny || p.createdById === ctx.user.id) && (
                      <DeletePostButton postId={p.id} status={p.status} canRemoveFromPlatforms={canPublish} compact />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button asChild variant="outline" size="sm" disabled={page <= 1}>
            <Link href={pageHref(page - 1, filter.key)}>Previous</Link>
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button asChild variant="outline" size="sm" disabled={page >= pages}>
            <Link href={pageHref(page + 1, filter.key)}>Next</Link>
          </Button>
        </div>
      )}
    </>
  );
}
