import { safeEqual } from "@platform/encryption";
import { drainForMs } from "@/lib/workers/runtime";
import { logger, errorInfo } from "@/lib/logger";

// Allow the function to run long enough to process a burst of jobs.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Serverless worker: processes queued jobs for ~50 seconds, then exits.
 * Triggered every minute by Vercel Cron (Authorization: Bearer CRON_SECRET),
 * or manually with the same header. Hosts with a persistent worker process
 * do not need this endpoint.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  const budget = Math.min(55_000, Number(new URL(req.url).searchParams.get("ms") ?? 50_000) || 50_000);
  try {
    const result = await drainForMs(budget);
    logger.info("drain finished", result);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    logger.error("drain failed", errorInfo(e));
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
