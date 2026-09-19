import { writeAudit } from "@platform/database";
import { prisma } from "./db";
import type { OrgContext } from "./session";

export async function audit(
  ctx: Pick<OrgContext, "organization" | "user" | "impersonatedBy">,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  metadata?: Record<string, unknown>,
  req?: Request,
) {
  return writeAudit(prisma, {
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    impersonatorId: ctx.impersonatedBy,
    action,
    resourceType,
    resourceId,
    metadata,
    ipAddress: req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req?.headers.get("user-agent") ?? null,
  });
}

export async function auditPlatform(
  actorUserId: string,
  action: string,
  resourceType: string,
  resourceId?: string | null,
  metadata?: Record<string, unknown>,
  organizationId?: string | null,
) {
  return writeAudit(prisma, {
    organizationId: organizationId ?? null,
    actorUserId,
    action,
    resourceType,
    resourceId,
    metadata,
  });
}
