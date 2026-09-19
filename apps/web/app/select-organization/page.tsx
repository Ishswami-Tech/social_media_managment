import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { OrganizationPicker } from "@/components/forms/organization-picker";

export const metadata = { title: "Select organization" };

export default async function SelectOrganizationPage() {
  const session = await requireUser();
  const memberships = await prisma.member.findMany({
    where: { userId: session.user.id, status: "ACTIVE" },
    include: { organization: { select: { id: true, name: true, slug: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invitations = await prisma.invitation.findMany({
    where: {
      email: session.user.email,
      status: "pending",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { organization: { select: { name: true } } },
  });
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <OrganizationPicker
        organizations={memberships.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
          status: m.organization.status,
        }))}
        invitations={invitations.map((i) => ({ id: i.id, organizationName: i.organization.name, role: i.role }))}
      />
    </div>
  );
}
