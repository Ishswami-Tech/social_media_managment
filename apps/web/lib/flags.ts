import { prisma } from "./db";

/** Feature flag check: globally enabled, or the organization is on the allow-list. */
export async function featureEnabled(key: string, organizationId?: string): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  if (!flag) return false;
  if (flag.enabled) return true;
  return !!organizationId && flag.organizationIds.includes(organizationId);
}
