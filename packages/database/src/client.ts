import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

declare global {
  var __platformPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn"] : [],
  });
}

/** Singleton accessor. Cached on globalThis so Next.js hot reloads don't exhaust the pool. */
export function getPrisma(): PrismaClient {
  if (!globalThis.__platformPrisma) globalThis.__platformPrisma = createClient();
  return globalThis.__platformPrisma;
}

/**
 * Lazy Prisma client: importing this module never opens a connection or
 * requires DATABASE_URL, so `next build` can collect routes without a
 * database. The real client is created on first property access.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    // Framework/runtime probes (thenable checks, React element checks, serialisation)
    // must not instantiate the real client.
    if (
      typeof prop === "symbol" ||
      prop === "then" ||
      prop === "toJSON" ||
      prop === "$$typeof" ||
      prop === "__esModule" ||
      prop === "default"
    )
      return undefined;
    const client = getPrisma();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

export type { PrismaClient };
