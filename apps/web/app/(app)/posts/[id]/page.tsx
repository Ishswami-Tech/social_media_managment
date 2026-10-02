import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { approvalRequired, postHistory } from "@/lib/services/posts";
import { mediaUrl } from "@/lib/services/media";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { PostPreview, type PreviewEngagement } from "@/components/preview/post-preview";
import { PostActions } from "@/components/forms/post-actions";
import { EditPublishedText } from "@/components/forms/edit-published-text";
import { PostEngagement } from "@/components/forms/post-engagement";
import { PLATFORM_LABELS } from "@/lib/providers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** A variant carrying its newest snapshot, which is all these helpers need. */
interface WithSnapshot {
  status: string;
  snapshots: { metrics: unknown; raw: unknown; capturedAt: Date }[];
}

/**
 * The figures to draw on the preview, or undefined while the post is not yet
 * live or has never been measured — in which case the preview keeps its
 * composing look rather than claiming zero engagement.
 */
function engagementOf(variant: WithSnapshot): PreviewEngagement | undefined {
  if (variant.status !== "PUBLISHED") return undefined;
  const snapshot = variant.snapshots[0];
  if (!snapshot) return {};
  const metrics = (snapshot.metrics ?? {}) as Record<string, number | undefined>;
  const byType = (snapshot.raw as { reactions?: { byType?: Record<string, number> } } | null)?.reactions?.byType;
  return {
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    byType,
    capturedAt: snapshot.capturedAt,
  };
}

/** Every figure the page can show for one post, in the order people look for them. */
const METRIC_ORDER = ["impressions", "reach", "likes", "comments", "shares", "clicks"] as const;
const METRIC_LABELS: Record<(typeof METRIC_ORDER)[number], string> = {
  impressions: "Impressions",
  reach: "Reach",
  likes: "Reactions",
  comments: "Comments",
  shares: "Shares",
  clicks: "Clicks",
};
const REACTION_NAMES: Record<string, string> = {
  LIKE: "like",
  PRAISE: "celebrate",
  EMPATHY: "support",
  INTEREST: "insightful",
  APPRECIATION: "love",
  ENTERTAINMENT: "funny",
};

/**
 * Everything known about how one live post is doing.
 *
 * Shows every metric, including the ones this account's token never
 * receives, so the absence is visible and explained rather than silently
 * missing. A figure the platform did not report is an em dash.
 */
function VariantAnalytics({ variant }: { variant: WithSnapshot }) {
  const snapshot = variant.snapshots[0];
  if (!snapshot) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-[12.5px] text-muted-foreground">
        No figures yet. The analytics worker reads engagement from the platform every 6 hours.
      </p>
    );
  }
  const metrics = (snapshot.metrics ?? {}) as Record<string, number | undefined>;
  const byType = (snapshot.raw as { reactions?: { byType?: Record<string, number> } } | null)?.reactions?.byType ?? {};
  const kinds = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const unreported = METRIC_ORDER.filter((k) => metrics[k] === undefined);

  return (
    <section aria-label="Post analytics" className="grid gap-3 rounded-lg border border-border p-3">
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
        {METRIC_ORDER.map((key) => (
          <div key={key} className="grid gap-0.5">
            <dt className="text-[11.5px] text-muted-foreground">{METRIC_LABELS[key]}</dt>
            <dd className="font-display text-[20px] leading-none font-bold tabular-nums">
              {metrics[key] === undefined ? (
                <span className="text-muted-foreground/60">—</span>
              ) : (
                metrics[key].toLocaleString()
              )}
            </dd>
          </div>
        ))}
      </dl>
      {kinds.length > 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          {kinds.map(([type, n]) => `${n} ${REACTION_NAMES[type] ?? type.toLowerCase()}`).join(" · ")}
        </p>
      )}
      <p className="text-[12px] text-muted-foreground">
        Read {formatDate(snapshot.capturedAt)}
        {unreported.length > 0 && (
          <>
            {" · "}
            {unreported.map((k) => METRIC_LABELS[k].toLowerCase()).join(", ")} are not available for a personal profile
            on this platform
          </>
        )}
      </p>
    </section>
  );
}

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
          // Latest reading of how the live post is doing; absent until the analytics worker runs.
          snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
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
  const history = await postHistory(ctx, post.id);
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
                  {v.externalUrl && v.status !== "DELETED" && (
                    <a href={v.externalUrl} target="_blank" rel="noreferrer" className="underline">
                      View live post
                    </a>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <PostPreview
                  platform={v.platform}
                  account={{ displayName: v.socialAccount.displayName, avatarUrl: v.socialAccount.avatarUrl }}
                  text={v.text}
                  media={v.media.map((m) => ({
                    id: m.mediaAsset.id,
                    url: mediaUrls[m.mediaAsset.id]!,
                    alt: m.mediaAsset.altText,
                  }))}
                  engagement={engagementOf(v)}
                />
                {v.status === "PUBLISHED" && <VariantAnalytics variant={v} />}
                {v.status === "PUBLISHED" && v.externalPostId && ctx.can("content:publish") && (
                  <PostEngagement
                    postId={post.id}
                    variantId={v.id}
                    platformLabel={PLATFORM_LABELS[v.platform as keyof typeof PLATFORM_LABELS] ?? v.platform}
                  />
                )}
                {v.status === "PUBLISHED" && v.externalPostId && v.platform === "LINKEDIN" && ctx.can("content:publish") && (
                  <EditPublishedText postId={post.id} variantId={v.id} text={v.text} maxLength={3000} />
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
              autoPublishOnApproval: post.autoPublishOnApproval,
            }}
            needsApproval={needsApproval}
            permissions={{
              canPublish: ctx.can("content:publish"),
              canApprove: ctx.can("content:approve"),
              canEdit: ctx.can("content:edit_any") || post.createdById === ctx.user.id,
              canDelete: ctx.can("content:delete") || post.createdById === ctx.user.id,
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
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>Every change, review, publish attempt and removal.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {history.length === 0 && <p className="text-muted-foreground">No events yet.</p>}
              {history.map((e) => (
                <div key={e.id} className="border-l-2 pl-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{e.action}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(e.at)}</span>
                  </div>
                  {(e.actor || e.detail) && (
                    <p className="text-xs text-muted-foreground">
                      {[e.actor, e.detail].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
