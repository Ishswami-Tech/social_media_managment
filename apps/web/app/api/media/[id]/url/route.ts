import { json, notFound, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/services/media";

export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "accounts:view", async (ctx) => {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: (await params).id, organizationId: ctx.organization.id },
    });
    if (!asset) throw notFound("Media asset");
    return json({ url: await mediaUrl(asset), thumbnailUrl: await mediaUrl(asset, "thumbnail") });
  });
