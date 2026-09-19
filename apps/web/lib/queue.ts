import { QueueRegistry, redisConnection } from "@platform/queue";
import { getEnv } from "./env";

declare global {
  var __platformQueues: QueueRegistry | undefined;
}

export function queues(): QueueRegistry {
  if (!globalThis.__platformQueues)
    globalThis.__platformQueues = new QueueRegistry(redisConnection(getEnv().REDIS_URL));
  return globalThis.__platformQueues;
}
