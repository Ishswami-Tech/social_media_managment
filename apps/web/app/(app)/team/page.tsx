import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { canAssignRole } from "@platform/rbac";
import { ORG_ROLES } from "@platform/types";
import { PageHeader } from "@/components/app/page-header";
import { TeamManager } from "@/components/forms/team-manager";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireOrg();
  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId: ctx.organization.id },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { organizationId: ctx.organization.id, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const assignable = ORG_ROLES.filter((r) => canAssignRole(ctx.actor, r, { overrides: ctx.overrides }));
  return (
    <>
      <PageHeader
        title="Team"
        description="Roles map to the permission matrix; configurable capabilities are set under Settings."
      />
      <TeamManager
        currentUserId={ctx.user.id}
        canManage={ctx.can("org:members")}
        assignableRoles={assignable}
        members={members.map((m) => ({
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          status: m.status,
        }))}
        invitations={invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}
