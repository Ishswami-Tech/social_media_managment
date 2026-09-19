import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Audit logs" };

export default async function AdminAuditLogs({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; org?: string }>;
}) {
  const { action, org } = await searchParams;
  const logs = await prisma.auditLog.findMany({
    where: { ...(action ? { action: { startsWith: action } } : {}), ...(org ? { organizationId: org } : {}) },
    include: { actor: { select: { name: true, email: true } }, organization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <>
      <PageHeader
        title="Audit logs"
        description="Every privileged and tenant-level action. Secrets are redacted before storage."
      />
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {formatDate(l.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {l.actor?.name ?? "system"} {l.impersonatorId && <Badge variant="warning">impersonated</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{l.organization?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{l.action}</TableCell>
                  <TableCell className="text-xs">
                    {l.resourceType}{" "}
                    {l.resourceId ? <span className="text-muted-foreground">{l.resourceId.slice(0, 8)}…</span> : null}
                  </TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-[10px] text-muted-foreground">
                    {l.metadata ? JSON.stringify(l.metadata) : ""}
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
