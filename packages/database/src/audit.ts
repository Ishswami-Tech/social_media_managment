import { redactSecrets } from "@platform/encryption";
import type { PrismaClient } from "./generated/prisma/client";

export interface AuditEntry {
  organizationId?: string | null;
  actorUserId?: string | null;
  impersonatorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Write an audit record. Metadata is passed through redactSecrets so a token or
 * password can never end up in the audit table by accident.
 */
export async function writeAudit(client: Pick<PrismaClient, "auditLog">, entry: AuditEntry) {
  return client.auditLog.create({
    data: {
      organizationId: entry.organizationId ?? null,
      actorUserId: entry.actorUserId ?? null,
      impersonatorId: entry.impersonatorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ? (redactSecrets(entry.metadata) as object) : undefined,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}
