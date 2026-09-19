import { loadEnv, type Env } from "@platform/config";

/** Lazily parsed so `next build` can collect routes without a full environment. */
export function getEnv(): Env {
  return loadEnv();
}
