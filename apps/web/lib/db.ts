import { getPrisma, prisma, withTenantGuard } from "@platform/database";
import { Keyring } from "@platform/encryption";
import { getEnv } from "./env";

/** Raw client for system code (auth adapter, workers acting on ids, super-admin tooling). */
export { prisma };

export type Db = ReturnType<typeof withTenantGuard<ReturnType<typeof getPrisma>>>;

declare global {
  var __platformDb: Db | undefined;
}

export function getDb(): Db {
  if (!globalThis.__platformDb) globalThis.__platformDb = withTenantGuard(getPrisma());
  return globalThis.__platformDb;
}

/**
 * Guarded client: throws if a tenant-owned table is queried without organizationId.
 * Built lazily on first access so importing this module needs no database.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const client = getDb();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

let ring: Keyring | undefined;
export function keyring(): Keyring {
  if (!ring) ring = Keyring.fromEnv(getEnv().ENCRYPTION_KEY);
  return ring;
}
