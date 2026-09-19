import { Prisma } from "./generated/prisma/client";
import type { PrismaClient } from "./generated/prisma/client";

/**
 * Tables that belong to exactly one organization. Any read/update/delete on
 * these models MUST filter by organizationId; the extension below rejects
 * queries that do not, which turns a forgotten `where` into a loud failure
 * instead of a silent cross-tenant leak (spec §21, §32).
 */
export const TENANT_MODELS = new Set<string>([
  "SocialAccount",
  "MediaAsset",
  "Post",
  "AIUsage",
  "OrganizationAIKey",
  "Brand",
  "Contact",
  "Conversation",
  "WhatsAppAccount",
  "WhatsAppTemplate",
  "Campaign",
  "Automation",
  "AnalyticsSnapshot",
  "OAuthState",
]);

const GUARDED_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "updateMany",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

export class TenantIsolationError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant isolation violation: ${model}.${operation} called without organizationId filter`);
    this.name = "TenantIsolationError";
  }
}

export function hasOrganizationFilter(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  if (typeof w.organizationId === "string") return true;
  if (w.organizationId && typeof w.organizationId === "object") {
    const o = w.organizationId as Record<string, unknown>;
    if (typeof o.equals === "string") return true;
    if (Array.isArray(o.in) && o.in.length > 0) return true;
  }
  if (Array.isArray(w.AND)) return w.AND.some(hasOrganizationFilter);
  // OR requires every branch to be scoped; otherwise one branch could leak.
  if (Array.isArray(w.OR) && w.OR.length > 0) return w.OR.every(hasOrganizationFilter);
  return false;
}

/**
 * Wraps the client with the tenant guard. Use `db` from the app for every
 * organization-scoped access; use the raw `prisma` client only in system code
 * (workers processing a specific record by id, super-admin tooling) where the
 * organization is established by other means.
 */
export function withTenantGuard<C extends PrismaClient>(client: C) {
  return client.$extends({
    name: "tenantGuard",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (TENANT_MODELS.has(model) && GUARDED_OPS.has(operation)) {
            const where = (args as { where?: unknown }).where;
            if (!hasOrganizationFilter(where)) throw new TenantIsolationError(model, operation);
          }
          return query(args);
        },
      },
    },
  });
}

/**
 * Convenience: a client whose tenant-scoped reads are automatically filtered by
 * organizationId. Combine with withTenantGuard for defence in depth.
 */
export function forOrganization<C extends PrismaClient>(client: C, organizationId: string) {
  return client.$extends({
    name: `org:${organizationId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (TENANT_MODELS.has(model)) {
            const a = args as { where?: Record<string, unknown>; data?: Record<string, unknown> };
            if (
              GUARDED_OPS.has(operation) ||
              operation === "findUnique" ||
              operation === "findUniqueOrThrow" ||
              operation === "update" ||
              operation === "delete"
            ) {
              a.where = { ...(a.where ?? {}), organizationId };
            }
            if (operation === "create" && a.data) a.data = { ...a.data, organizationId };
          }
          return query(args);
        },
      },
    },
  });
}

export type TenantScopedClient = ReturnType<typeof forOrganization>;
export { Prisma };
