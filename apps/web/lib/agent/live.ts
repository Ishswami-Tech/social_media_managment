/**
 * Live progress channel per campaign. The worker publishes here whenever it
 * stores something or a model produces more text; the stream route forwards
 * it to the browser at once instead of waiting for the next database poll.
 */
import { createLiveBus, type LiveBus } from "@platform/queue";
import type { LivePartial } from "@platform/agent-council/live";
import { getEnv } from "@/lib/env";

declare global {
  var __platformLiveBus: LiveBus | undefined;
}

export type LiveMessage = { type: "poke" } | ({ type: "partial" } & LivePartial);

export function liveBus(): LiveBus {
  if (!globalThis.__platformLiveBus) globalThis.__platformLiveBus = createLiveBus(getEnv().REDIS_URL);
  return globalThis.__platformLiveBus;
}

export const runChannel = (runId: string): string => `agent:run:${runId}`;

/** Fire-and-forget; a dead Redis only costs freshness. */
export function publishRun(runId: string, message: LiveMessage): void {
  void liveBus().publish(runChannel(runId), message);
}
