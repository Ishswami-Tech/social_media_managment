import Link from "next/link";
import { POST_STATUSES, type PostStatus } from "@platform/types";
import { requireOrg } from "@/lib/session";
import { listPosts } from "@/lib/services/posts";
import { formatDate, truncate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Posts" };

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const status = POST_STATUSES.includes(sp.status as PostStatus) ? (sp.status as PostStatus) : undefined;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const canSeeAll = ctx.can("content:edit_any") || ctx.can("content:approve");
  const { items, total, pageSize } = await listPosts(ctx, { status, page, pageSize: 25, mine: !canSeeAll });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filters: (PostStatus | "ALL")[] = [
    "ALL",
    "DRAFT",
    "IN_REVIEW",
    "APPROVED",
    "SCHEDULED",
    "QUEUED",
    "PUBLISHED",
    "FAILED",
  ];

  return (
    <>
      <PageHeader title="Posts" description={`${total} post(s)`}>
        {ctx.can("content:create") && (
          <Button asChild>
            <Link href="/create">New post</Link>
          </Button>
        )}
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button key={f} asChild size="sm" variant={(f === "ALL" && !status) || f === status ? "default" : "outline"}>
            <Link href={f === "ALL" ? "/posts" : `/posts?status=${f}`}>{f.replaceAll("_", " ").toLowerCase()}</Link>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No posts match this filter.
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button asChild variant="outline" size="sm" disabled={page <= 1}>
            <Link href={`/posts?${status ? `status=${status}&` : ""}page=${page - 1}`}>Previous</Link>
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button asChild variant="outline" size="sm" disabled={page >= pages}>
            <Link href={`/posts?${status ? `status=${status}&` : ""}page=${page + 1}`}>Next</Link>
          </Button>
        </div>
      )}
    </>
  );
}
