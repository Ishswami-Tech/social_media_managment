import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { OrganizationAdminActions } from "@/components/forms/admin-org-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Organizations" };

export default async function AdminOrganizations() {
  const [orgs, plans] = await Promise.all([
    prisma.organization.findMany({
      include: { plan: true, _count: { select: { members: true, socialAccounts: true, posts: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.plan.findMany({
      where: { active: true },
      orderBy: { priceCents: "asc" },
      select: { slug: true, name: true },
    }),
  ]);
  return (
    <>
      <PageHeader
        title="Organizations"
        description="Suspend, reactivate or archive tenants and assign plans. All actions are audited."
      />
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Accounts</TableHead>
                <TableHead>Posts</TableHead>
                <TableHead>Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <span className="block font-medium">{o.name}</span>
                    <span className="text-xs text-muted-foreground">/{o.slug}</span>
                  </TableCell>
                  <TableCell>{o.plan?.name ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell>{o._count.members}</TableCell>
                  <TableCell>{o._count.socialAccounts}</TableCell>
                  <TableCell>{o._count.posts}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(o.createdAt, { dateStyle: "medium" })}
                  </TableCell>
                  <TableCell className="text-right">
                    <OrganizationAdminActions
                      id={o.id}
                      status={o.status}
                      planSlug={o.plan?.slug ?? null}
                      plans={plans}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
