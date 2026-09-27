/**
 * A tiny HTTP listener beside the queues.
 *
 * Nothing about a BullMQ worker needs a socket, but hosts that deploy every
 * service the same way (Temps among them) wait for one to answer before they
 * consider the container up, and kill it when nothing does. It doubles as a
 * real liveness probe: it reports whether the queues are still attached, so a
 * worker that has lost them reads as unhealthy rather than merely alive.
 */
import { createServer, type Server } from "node:http";
import { logger, errorInfo } from "@/lib/logger";

export interface WorkerHealth {
  /** Queue names this process is consuming. */
  queues: string[];
  /** False once shutdown has begun, so a draining worker stops claiming to be ready. */
  running: () => boolean;
}

/** Starts the probe on PORT. Resolves once it is listening, or when the port cannot be taken. */
export function startHealthServer(health: WorkerHealth, port = Number(process.env.PORT ?? 3000)): Promise<Server | undefined> {
  const started = Date.now();
  const server = createServer((req, res) => {
    const ok = health.running();
    const body = JSON.stringify({
      ok,
      service: "worker",
      queues: health.queues,
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      time: new Date().toISOString(),
    });
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  });

  return new Promise((resolve) => {
    // A worker that cannot bind still has queues to run: log it and carry on.
    server.once("error", (error) => {
      logger.warn("worker health port unavailable", { port, ...errorInfo(error) });
      resolve(undefined);
    });
    server.listen(port, "0.0.0.0", () => {
      logger.info("worker health endpoint listening", { port });
      resolve(server);
    });
  });
}
