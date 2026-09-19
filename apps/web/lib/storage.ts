import { MemoryStorage, R2Storage, type ObjectStorage } from "@platform/media";
import { getEnv } from "./env";
import { logger } from "./logger";

declare global {
  var __platformStorage: ObjectStorage | undefined;
}

export function storage(): ObjectStorage {
  if (globalThis.__platformStorage) return globalThis.__platformStorage;
  const env = getEnv();
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET) {
    globalThis.__platformStorage = new R2Storage({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL,
    });
  } else {
    if (env.NODE_ENV === "production")
      logger.warn("R2 is not configured; falling back to in-memory storage (media will not persist)");
    globalThis.__platformStorage = new MemoryStorage(`${env.APP_URL}/api/media/dev`);
  }
  return globalThis.__platformStorage;
}
