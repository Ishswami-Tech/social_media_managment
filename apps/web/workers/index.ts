/**
 * Long-running worker process (spec §15). Runs alongside the web app on hosts
 * with persistent processes (Docker, Coolify, Railway, Fly):
 *   pnpm --filter web worker
 *
 * On Vercel, use the cron-driven drain endpoint instead (see vercel.json).
 */
import "dotenv/config";
import { startWorkers } from "@/lib/workers/runtime";
import { startHealthServer } from "./health";
import { logger, errorInfo } from "@/lib/logger";

async function main() {
  const workers = await startWorkers();
  logger.info("workers started", { queues: workers.map((w) => w.name) });
  let running = true;
  const health = await startHealthServer({ queues: workers.map((w) => w.name), running: () => running });
  const shutdown = async (signal: string) => {
    logger.info("shutting down workers", { signal });
    running = false;
    health?.close();
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
