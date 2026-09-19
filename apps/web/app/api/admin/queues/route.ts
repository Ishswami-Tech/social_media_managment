import { json, withSuperAdmin } from "@/lib/api";
import { prisma } from "@/lib/db";
import { queues } from "@/lib/queue";

export const GET = (req: Request) =>
  withSuperAdmin(req, async () => {
    const [stats, failedJobs, failedWebhooks] = await Promise.all([
      queues().stats(),
      prisma.publishJob.findMany({
        where: { status: "FAILED" },
        orderBy: { updatedAt: "desc" },
        take: 20,
        include: {
          postVariant: { select: { platform: true, postId: true, post: { select: { organizationId: true } } } },
        },
      }),
      prisma.webhookEvent.findMany({
        where: { status: "FAILED" },
        orderBy: { receivedAt: "desc" },
        take: 20,
        select: { id: true, provider: true, eventType: true, error: true, receivedAt: true },
      }),
    ]);
    return json({ queues: stats, failedJobs, failedWebhooks });
  });
