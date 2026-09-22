import { Queue, Worker, type ConnectionOptions, type JobsOptions, type Processor, type WorkerOptions } from "bullmq";
import { QUEUES, type JobDataMap, type QueueName } from "./jobs";

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * BullMQ forbids ":" in custom job ids (it is the Redis key separator). Our
 * logical keys use ":" for readability, so every id passes through here.
 */
export function toJobId(logicalKey: string): string {
  return logicalKey.replace(/:/g, "__");
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
  attempts: 1, // retries are decided by our own policy (decideRetry) to keep DB state authoritative
};

/**
 * Agent Council runs retry in BullMQ (FAILED -> QUEUED is the only retry path):
 * three attempts with exponential backoff, then the job is parked on `dead-letter`.
 */
export const AGENT_RUN_JOB_OPTIONS = { attempts: 3, backoffMs: 30_000 } as const;

export interface EnqueueOptions {
  delayMs?: number;
  priority?: number;
  /** Overrides the default single attempt (BullMQ-managed retries). */
  attempts?: number;
  /** Exponential backoff base delay used when `attempts` > 1. */
  backoffMs?: number;
}

export class QueueRegistry {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connection: ConnectionOptions) {}

  get<N extends QueueName>(name: N): Queue<JobDataMap[N]> {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.queues.set(name, q);
    }
    return q as Queue<JobDataMap[N]>;
  }

  /**
   * Enqueue with an explicit jobId so re-enqueuing the same logical job is a
   * no-op (idempotent publishing, spec §32).
   */
  async enqueue<N extends QueueName>(
    name: N,
    jobId: string,
    data: JobDataMap[N],
    opts: EnqueueOptions = {},
  ) {
    const q = this.get(name) as Queue;
    return q.add(name, data, {
      jobId: toJobId(jobId),
      delay: opts.delayMs,
      priority: opts.priority,
      ...(opts.attempts !== undefined ? { attempts: opts.attempts } : {}),
      ...(opts.backoffMs !== undefined ? { backoff: { type: "exponential", delay: opts.backoffMs } } : {}),
    });
  }

  async getJob(name: QueueName, jobId: string) {
    return this.get(name).getJob(toJobId(jobId));
  }

  async remove(name: QueueName, jobId: string): Promise<boolean> {
    const job = await this.get(name).getJob(toJobId(jobId));
    if (!job) return false;
    const state = await job.getState();
    if (state === "active") return false;
    await job.remove();
    return true;
  }

  async stats() {
    const out: Record<string, { waiting: number; active: number; delayed: number; failed: number; completed: number }> =
      {};
    for (const name of Object.values(QUEUES)) {
      const q = this.get(name);
      const [waiting, active, delayed, failed, completed] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getDelayedCount(),
        q.getFailedCount(),
        q.getCompletedCount(),
      ]);
      out[name] = { waiting, active, delayed, failed, completed };
    }
    return out;
  }

  async close() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

export function createWorker<N extends QueueName>(
  name: N,
  connection: ConnectionOptions,
  processor: Processor<JobDataMap[N]>,
  opts: Partial<WorkerOptions> = {},
) {
  return new Worker<JobDataMap[N]>(name, processor, { connection, concurrency: 5, ...opts });
}
