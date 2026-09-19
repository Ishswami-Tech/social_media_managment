import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { ContactForm } from "@/components/forms/contact-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  const ctx = await requireCapability("whatsapp:view");
  const contacts = await prisma.contact.findMany({
    where: { organizationId: ctx.organization.id },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { _count: { select: { conversations: true } } },
  });
  return (
    <>
      <PageHeader title="Contacts" description={`${contacts.length} contact(s)`}>
        {ctx.can("whatsapp:reply") && <ContactForm />}
      </PageHeader>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Conversations</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.name ?? "—"} {c.optedOut && <Badge variant="destructive">opted out</Badge>}
                  </TableCell>
                  <TableCell>+{c.phone}</TableCell>
                  <TableCell className="space-x-1">
                    {c.tags.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>{c._count.conversations}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(c.lastSeenAt)}</TableCell>
                </TableRow>
              ))}
              {contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Contacts are created automatically from inbound messages, or add them here.
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
