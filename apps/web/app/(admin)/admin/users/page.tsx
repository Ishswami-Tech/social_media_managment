import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { UserAdminActions } from "@/components/forms/admin-user-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Users" };

export default async function AdminUsers() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { members: { include: { organization: { select: { name: true } } } } },
  });
  return (
    <>
      <PageHeader
        title="Users"
        description="Promote Super Admins, ban accounts, or impersonate for support (audited)."
      />
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Platform role</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <span className="block font-medium">{u.name}</span>
                    <span className="text-xs text-muted-foreground">{u.email}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "outline"}>{u.role ?? "user"}</Badge>{" "}
                    {u.banned && <Badge variant="destructive">banned</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {u.members.map((m) => `${m.organization.name} (${m.role})`).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(u.createdAt, { dateStyle: "medium" })}
                  </TableCell>
                  <TableCell className="text-right">
                    <UserAdminActions id={u.id} role={u.role ?? "user"} banned={!!u.banned} />
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
