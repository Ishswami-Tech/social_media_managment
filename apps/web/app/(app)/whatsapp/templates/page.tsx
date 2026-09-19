import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { SyncTemplatesButton } from "@/components/forms/sync-templates";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "WhatsApp templates" };

export default async function TemplatesPage() {
  const ctx = await requireCapability("whatsapp:view");
  const [templates, accounts] = await Promise.all([
    prisma.whatsAppTemplate.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: { whatsappAccount: { select: { displayPhoneNumber: true } } },
    }),
    prisma.whatsAppAccount.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, displayPhoneNumber: true },
    }),
  ]);
  return (
    <>
      <PageHeader
        title="Message templates"
        description="Templates are created and reviewed in Meta Business Manager; status updates arrive by webhook."
      >
        {ctx.can("whatsapp:manage") &&
          accounts.map((a) => <SyncTemplatesButton key={a.id} accountId={a.id} label={a.displayPhoneNumber} />)}
      </PageHeader>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Body</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => {
                const body = (t.components as { type: string; text?: string }[]).find((c) => c.type === "BODY")?.text;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.language}</TableCell>
                    <TableCell>{t.category ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell>{t.whatsappAccount.displayPhoneNumber}</TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">{body}</TableCell>
                  </TableRow>
                );
              })}
              {templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No templates synced yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
