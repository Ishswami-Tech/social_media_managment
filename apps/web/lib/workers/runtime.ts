import { createWorker, redisConnection } from "@platform/queue";
import type { Worker } from "bullmq";
import { getEnv } from "../env";
import { logger, errorInfo } from "../logger";
import { collectAccountMetrics, collectPostMetrics } from "../services/analytics";
import { processMedia } from "../services/media";
import { runPublishJob } from "../services/publishing";
import { processWebhookEvent } from "../services/webhooks";
import { deliverOutbound } from "../services/whatsapp";
import { runCampaign } from "./campaigns";
import { runMaintenance, scheduleMaintenance } from "./maintenance";

/**
 * Builds the full set of BullMQ workers. Used by the long-running worker
 * process (workers/index.ts) and by the cron-driven drain endpoint on
 * serverless hosts such as Vercel, where workers run in short bursts.
 */
export async function startWorkers(): Promise<Worker[]> {
  const connection = redisConnection(getEnv().REDIS_URL);
  const workers: Worker[] = [
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
  return workers;
}

/**
 * Run the workers for a bounded time window, then stop accepting new jobs and
 * wait for in-flight ones. Returns how many jobs completed/failed in the window.
 */
export async function drainForMs(budgetMs: number): Promise<{ completed: number; failed: number; ms: number }> {
  const started = Date.now();
  const workers = await startWorkers();
  let completed = 0;
  let failed = 0;
  for (const w of workers) {
    w.on("completed", () => completed++);
    w.on("failed", () => failed++);
  }
  await new Promise((r) => setTimeout(r, Math.max(1000, budgetMs)));
  await Promise.allSettled(workers.map((w) => w.close()));
  return { completed, failed, ms: Date.now() - started };
}
