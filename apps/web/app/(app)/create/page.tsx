import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/services/media";
import { PageHeader } from "@/components/app/page-header";
import { Composer } from "@/components/forms/composer";

export const metadata = { title: "Create post" };

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireCapability("content:create");
  const { edit } = await searchParams;
  const [accounts, media, brands, existing] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId: ctx.organization.id, status: "CONNECTED" },
      select: { id: true, platform: true, displayName: true, username: true, avatarUrl: true, capabilities: true },
      orderBy: { platform: "asc" },
    }),
    prisma.mediaAsset.findMany({
      where: { organizationId: ctx.organization.id, status: "READY", kind: { in: ["IMAGE", "GIF"] } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.brand.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, name: true, isDefault: true },
    }),
    edit
      ? prisma.post.findFirst({
          where: { id: edit, organizationId: ctx.organization.id },
          include: { variants: { include: { media: true } } },
        })
      : null,
  ]);
  const mediaWithUrls = await Promise.all(
    media.map(async (m) => ({
      id: m.id,
      fileName: m.fileName,
      url: await mediaUrl(m),
      thumbnailUrl: await mediaUrl(m, "thumbnail"),
    })),
  );
  return (
    <>
      <PageHeader
        title={existing ? "Edit post" : "Create post"}
        description="Write once, see it exactly as it will appear, adapt per platform, then submit. Approved posts publish automatically."
      />
      <Composer
        accounts={accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          displayName: a.displayName,
          username: a.username,
          avatarUrl: a.avatarUrl,
          maxLength: (a.capabilities as { text?: { maxLength?: number } } | null)?.text?.maxLength ?? 3000,
          mediaRequired: !!(a.capabilities as { media?: { required?: boolean } } | null)?.media?.required,
        }))}
        media={mediaWithUrls}
        brands={brands}
        canPublish={ctx.can("content:publish")}
        requireApproval={ctx.settings.requireApproval}
        aiEnabled={ctx.can("ai:generate")}
        existing={
          existing
            ? {
                id: existing.id,
                title: existing.title ?? "",
                masterText: existing.masterText,
                scheduledAt: existing.scheduledAt?.toISOString() ?? null,
                autoPublishOnApproval: existing.autoPublishOnApproval,
                variants: existing.variants.map((v) => ({
                  socialAccountId: v.socialAccountId,
                  text: v.text,
                  mediaAssetIds: v.media.map((m) => m.mediaAssetId),
                })),
              }
            : null
        }
      />
    </>
  );
}
