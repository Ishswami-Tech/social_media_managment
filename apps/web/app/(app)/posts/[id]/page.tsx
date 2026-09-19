import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { approvalRequired } from "@/lib/services/posts";
import { mediaUrl } from "@/lib/services/media";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { PostActions } from "@/components/forms/post-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrg();
  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, organizationId: ctx.organization.id },
    include: {
      variants: {
        include: {
          socialAccount: {
            select: {
              id: true,
              platform: true,
              displayName: true,
              avatarUrl: true,
              status: true,
              requireApproval: true,
            },
          },
          media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } },
          publishJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { attempts: { orderBy: { attemptNumber: "desc" }, take: 3 } },
          },
        },
      },
      approvals: { include: { reviewer: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
      createdBy: { select: { id: true, name: true, image: true } },
    },
  });
  if (!post) notFound();
  const needsApproval = approvalRequired(ctx, post);
  const mediaUrls: Record<string, string> = {};
  for (const v of post.variants)
    for (const m of v.media) mediaUrls[m.mediaAsset.id] = await mediaUrl(m.mediaAsset, "thumbnail");

  return (
    <>
      <PageHeader
        title={post.title || "Untitled post"}
        description={`Created by ${post.createdBy.name} · ${formatDate(post.createdAt)}`}
      >
        <StatusBadge status={post.status} />
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-4">
          {post.variants.map((v) => (
            <Card key={v.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PlatformIcon platform={v.platform} /> {v.socialAccount.displayName}
                </CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <StatusBadge status={v.status} />
                  {v.externalUrl && (
                    <a href={v.externalUrl} target="_blank" rel="noreferrer" className="underline">
                      View live post
                    </a>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm whitespace-pre-wrap">{v.text}</p>
                {v.media.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {v.media.map((m) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={m.id}
                        src={mediaUrls[m.mediaAsset.id]}
                        alt={m.mediaAsset.altText ?? m.mediaAsset.fileName}
                        className="size-20 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                )}
                {v.lastError && <p className="text-xs text-destructive">{v.lastError}</p>}
                {v.publishJobs[0]?.attempts.length ? (
                  <div className="text-xs text-muted-foreground">
                    {v.publishJobs[0].attempts.map((a) => (
                      <div key={a.id}>
                        Attempt {a.attemptNumber}: {a.status.toLowerCase()} {a.errorCode ? `(${a.errorCode})` : ""} ·{" "}
                        {formatDate(a.startedAt)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid content-start gap-4">
          <PostActions
            post={{
              id: post.id,
              status: post.status,
              approvalStatus: post.approvalStatus,
              scheduledAt: post.scheduledAt?.toISOString() ?? null,
              timezone: post.timezone,
              createdById: post.createdById,
            }}
            needsApproval={needsApproval}
            permissions={{
              canPublish: ctx.can("content:publish"),
              canApprove: ctx.can("content:approve"),
              canEdit: ctx.can("content:edit_any") || post.createdById === ctx.user.id,
              isOwnPost: post.createdById === ctx.user.id,
              isAdmin: ctx.role === "OWNER" || ctx.role === "ADMIN",
            }}
          />
          <Card>
            <CardHeader>
              <CardTitle>Approval history</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {post.approvals.length === 0 && <p className="text-muted-foreground">No reviews yet.</p>}
              {post.approvals.map((a) => (
                <div key={a.id} className="rounded-md border p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.reviewer.name}</span>
                    <StatusBadge status={a.decision} />
                  </div>
                  {a.comment && <p className="mt-1 text-muted-foreground">{a.comment}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(a.createdAt)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
