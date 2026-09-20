/**
 * Worker process entry point (spec §15). Runs alongside the web app:
 *   pnpm --filter web worker
 *
 * Each queue gets its own BullMQ Worker so they can be scaled or paused
 * independently. Retries for publishing are decided by our own policy
 * (decideRetry) rather than BullMQ so the PublishJob row stays authoritative.
 */
import "dotenv/config";
import { createWorker, redisConnection } from "@platform/queue";
import { getEnv } from "@/lib/env";
import { logger, errorInfo } from "@/lib/logger";
import { runPublishJob } from "@/lib/services/publishing";
import { processWebhookEvent } from "@/lib/services/webhooks";
import { deliverOutbound } from "@/lib/services/whatsapp";
import { processMedia } from "@/lib/services/media";
import { collectAccountMetrics, collectPostMetrics } from "@/lib/services/analytics";
import { runCampaign } from "./campaigns";
import { runMaintenance, scheduleMaintenance } from "./maintenance";

async function main() {
  const env = getEnv();
  const connection = redisConnection(env.REDIS_URL);

  const workers = [
    createWorker("publish", connection, async (job) => runPublishJob(job.data.publishJobId), { concurrency: 5 }),
    createWorker("webhooks", connection, async (job) => processWebhookEvent(job.data.webhookEventId), {
      concurrency: 10,
    }),
    createWorker("whatsapp-outbound", connection, async (job) => deliverOutbound(job.data.messageId), {
      concurrency: 10,
      limiter: { max: 50, duration: 1000 },
    }),
    createWorker("media", connection, async (job) => processMedia(job.data.mediaAssetId), { concurrency: 2 }),
    createWorker("campaigns", connection, async (job) => runCampaign(job.data.campaignId), { concurrency: 2 }),
    createWorker(
      "analytics",
      connection,
      async (job) => {
        if (job.data.postVariantId) await collectPostMetrics(job.data.postVariantId);
        else if (job.data.socialAccountId) await collectAccountMetrics(job.data.socialAccountId);
      },
      { concurrency: 3, limiter: { max: 20, duration: 1000 } },
    ),
    createWorker("maintenance", connection, async (job) => runMaintenance(job.data), { concurrency: 1 }),
  ];

  for (const w of workers) {
    w.on("completed", (job) => logger.debug("job completed", { queue: w.name, jobId: job.id }));
    w.on("failed", (job, err) => logger.warn("job failed", { queue: w.name, jobId: job?.id, ...errorInfo(err) }));
    w.on("error", (err) => logger.error("worker error", { queue: w.name, ...errorInfo(err) }));
  }
  await scheduleMaintenance();
  logger.info("workers started", { queues: workers.map((w) => w.name) });

  const shutdown = async (signal: string) => {
    logger.info("shutting down workers", { signal });
    await Promise.allSettled(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  logger.error("worker boot failed", errorInfo(e));
  process.exit(1);
});
