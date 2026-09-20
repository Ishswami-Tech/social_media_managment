import path from "node:path";
import { DiskStorage, R2Storage, type ObjectStorage } from "@platform/media";
import { getEnv } from "./env";
import { logger } from "./logger";

declare global {
  var __platformStorage: ObjectStorage | undefined;
}

/**
 * Object storage: Cloudflare R2 when configured, otherwise a local-disk
 * backend (shared by the web and worker processes) served through
 * /api/media/dev. Local disk is fine for development and single-node
 * deployments but is not replicated; production should configure R2.
 */
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
    const serverless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    const dir =
      getEnv().MEDIA_LOCAL_DIR ??
      (serverless ? path.join("/tmp", "social-ai-media") : path.join(process.cwd(), ".data", "media"));
    if (env.NODE_ENV === "production")
      logger.warn(
        serverless
          ? "R2 is not configured; media is stored in /tmp and will NOT persist between invocations. Configure R2_* for production."
          : "R2 is not configured; using local-disk media storage",
        { dir },
      );
    globalThis.__platformStorage = new DiskStorage(dir, `${env.APP_URL}/api/media/dev`);
  }
  return globalThis.__platformStorage;
}

export function localStorageBackend(): DiskStorage | null {
  const s = storage();
  return s.kind === "disk" ? (s as DiskStorage) : null;
}
