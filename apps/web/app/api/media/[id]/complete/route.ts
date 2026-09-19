import { json, withOrg } from "@/lib/api";
import { completeUpload } from "@/lib/services/media";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "media:upload", async (ctx) => json({ asset: await completeUpload(ctx, (await params).id) }));
