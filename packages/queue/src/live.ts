import Redis from "ioredis";

/**
 * Redis pub/sub for live progress. Publishing is fire-and-forget: a dead Redis
 * costs freshness, never correctness, because every screen also tails the
 * database.
 */
export interface LiveBus {
  publish(channel: string, payload: unknown): Promise<void>;
  /** Resolves with the function that unsubscribes and closes the subscriber connection. */
  subscribe(channel: string, onMessage: (payload: unknown) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

const OPTIONS = { maxRetriesPerRequest: 1, connectTimeout: 3_000 } as const;

export function createLiveBus(redisUrl: string): LiveBus {
  const publisher = new Redis(redisUrl, { ...OPTIONS, lazyConnect: true });
  publisher.on("error", () => {
    /* surfaced per command; avoids unhandled 'error' events crashing the process */
  });
  return {
    async publish(channel, payload) {
      try {
        await publisher.publish(channel, JSON.stringify(payload));
      } catch {
        // Best effort by design: the stored rows carry the same facts.
      }
    },
    async subscribe(channel, onMessage) {
      const subscriber = new Redis(redisUrl, OPTIONS);
      subscriber.on("error", () => {
        /* the caller keeps polling; nothing to do here */
      });
      subscriber.on("message", (from: string, raw: string) => {
        if (from !== channel) return;
        try {
          onMessage(JSON.parse(raw));
        } catch {
          // A malformed message is dropped; the next one is independent.
        }
      });
      await subscriber.subscribe(channel);
      return async () => {
        try {
          await subscriber.unsubscribe(channel);
        } finally {
          subscriber.disconnect();
        }
      };
    },
    async close() {
      publisher.disconnect();
    },
  };
}
