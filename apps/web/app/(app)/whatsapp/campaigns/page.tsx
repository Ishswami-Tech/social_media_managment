import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { CampaignForm } from "@/components/forms/campaign-form";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "WhatsApp campaigns" };

export default async function CampaignsPage() {
  const ctx = await requireCapability("whatsapp:manage");
  const [campaigns, accounts, templates, tags] = await Promise.all([
    prisma.campaign.findMany({ where: { organizationId: ctx.organization.id }, orderBy: { createdAt: "desc" } }),
    prisma.whatsAppAccount.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, displayPhoneNumber: true },
    }),
    prisma.whatsAppTemplate.findMany({
      where: { organizationId: ctx.organization.id, status: "APPROVED" },
      select: { whatsappAccountId: true, name: true, language: true },
    }),
    prisma.contact.findMany({ where: { organizationId: ctx.organization.id }, select: { tags: true } }),
  ]);
  const allTags = [...new Set(tags.flatMap((t) => t.tags))];
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Template broadcasts to tagged audiences. Opted-out contacts are always excluded."
      >
        <CampaignForm accounts={accounts} templates={templates} tags={allTags} />
      </PageHeader>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">Sent / Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    {c.templateName} ({c.templateLanguage})
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(c.scheduledAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.totalRecipients}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.sentCount} / {c.failedCount}
                  </TableCell>
                </TableRow>
              ))}
              {campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No campaigns yet.
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
