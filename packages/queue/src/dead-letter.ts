import type { Job, JobType } from "bullmq";
import type { DeadLetterJobData, JobDataMap, QueueName } from "./jobs";
import type { QueueRegistry } from "./queues";

/**
 * Dead-letter queue helpers. A job that exhausted its retries on any queue is
 * parked here (no worker consumes this queue) so an administrator can inspect
 * the payload and error, then re-enqueue it on its original queue.
 */

/** Logical dead-letter job id: `${queue}:${originalJobId}:${failedAt}` (":" is mapped by the registry). */
export function deadLetterJobId(queue: QueueName, originalJobId: string, failedAt: string): string {
  return `${queue}:${originalJobId}:${failedAt}`;
}

/**
 * Fresh id for a retried job. BullMQ keeps completed/failed jobs around for a
 * while, so re-using the original id would be silently ignored as a duplicate.
 */
export function retryJobId(originalJobId: string, now: number = Date.now()): string {
  return `${originalJobId}:retry-${now}`;
}

/** True when the failure that just happened was the job's last allowed attempt. */
export function attemptsExhausted(attemptsMade: number, attempts: number | undefined): boolean {
  return attemptsMade >= Math.max(1, attempts ?? 1);
}

export interface DeadLetterEntry {
  id: string;
  data: DeadLetterJobData;
  /** Epoch millis at which the entry was parked */
  parkedAt: number;
}

export async function parkDeadLetter(registry: QueueRegistry, data: DeadLetterJobData): Promise<{ id: string }> {
  const job = await registry.enqueue("dead-letter", deadLetterJobId(data.queue, data.originalJobId, data.failedAt), data);
  return { id: String(job.id) };
}

const DEAD_LETTER_STATES: JobType[] = ["waiting", "delayed", "prioritized"];

export async function listDeadLetters(registry: QueueRegistry, limit = 50): Promise<DeadLetterEntry[]> {
  const jobs: Job<DeadLetterJobData>[] = await registry
    .get("dead-letter")
    .getJobs(DEAD_LETTER_STATES, 0, Math.max(0, limit - 1), false);
  return jobs
    .filter((j): j is Job<DeadLetterJobData> & { id: string } => typeof j.id === "string")
    .map((j) => ({ id: j.id, data: j.data, parkedAt: j.timestamp }))
    .sort((a, b) => b.parkedAt - a.parkedAt);
}

/**
 * Re-enqueue the original job on its queue with a fresh id and remove the
 * dead-letter entry. Returns the new job id, or undefined when the entry no
 * longer exists.
 */
export async function retryDeadLetter(
  registry: QueueRegistry,
  deadLetterId: string,
  opts: { now?: number; attempts?: number; backoffMs?: number } = {},
): Promise<{ queue: QueueName; jobId: string } | undefined> {
  const job = await registry.get("dead-letter").getJob(deadLetterId);
  if (!job) return undefined;
  const { queue, originalJobId, data } = job.data;
  const retried = await registry.enqueue(queue, retryJobId(originalJobId, opts.now), data as JobDataMap[QueueName], {
    attempts: opts.attempts,
    backoffMs: opts.backoffMs,
  });
  await job.remove();
  return { queue, jobId: String(retried.id) };
}
