import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/services/media";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { MediaUploader } from "@/components/forms/media-uploader";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Media library" };

export default async function MediaPage() {
  const ctx = await requireOrg();
  const assets = await prisma.mediaAsset.findMany({
    where: { organizationId: ctx.organization.id, status: { not: "PENDING_UPLOAD" } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const items = await Promise.all(
    assets.map(async (a) => ({
      ...a,
      thumb: a.kind === "IMAGE" || a.kind === "GIF" ? await mediaUrl(a, "thumbnail") : null,
    })),
  );
  return (
    <>
      <PageHeader
        title="Media library"
        description="Uploads are validated, de-duplicated by checksum, stripped of metadata and rendered per platform."
      >
        {ctx.can("media:upload") && <MediaUploader />}
      </PageHeader>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
        {items.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No media yet.</p>}
        {items.map((a) => (
          <Card key={a.id} className="gap-2 overflow-hidden py-0">
            <div className="flex aspect-square items-center justify-center bg-muted">
              {a.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumb} alt={a.altText ?? a.fileName} className="size-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground uppercase">{a.kind}</span>
              )}
            </div>
            <CardContent className="px-3 pb-3">
              <p className="truncate text-xs font-medium" title={a.fileName}>
                {a.fileName}
              </p>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {a.width && a.height ? `${a.width}×${a.height} · ` : ""}
                  {(a.size / 1024).toFixed(0)} KB
                </span>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {a.source === "AI_GENERATED" ? "AI · " : ""}
                {formatDate(a.createdAt, { dateStyle: "short" })}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
