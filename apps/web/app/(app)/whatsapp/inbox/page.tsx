import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { Inbox } from "@/components/forms/inbox";
import { WhatsAppConnect } from "@/components/forms/whatsapp-connect";

export const metadata = { title: "WhatsApp inbox" };

export default async function InboxPage() {
  const ctx = await requireCapability("whatsapp:view");
  const [accounts, members] = await Promise.all([
    prisma.whatsAppAccount.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, displayPhoneNumber: true, verifiedName: true, status: true },
    }),
    prisma.member.findMany({
      where: { organizationId: ctx.organization.id, status: "ACTIVE" },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  return (
    <>
      <PageHeader
        title="WhatsApp inbox"
        description={
          accounts.length
            ? accounts.map((a) => `${a.verifiedName ?? ""} ${a.displayPhoneNumber}`).join(" · ")
            : "Connect a WhatsApp Business number to start receiving messages."
        }
      >
        {ctx.can("whatsapp:manage") && <WhatsAppConnect />}
      </PageHeader>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No WhatsApp Business account connected yet. Register your webhook at /api/webhooks/whatsapp on the Meta app
          dashboard once connected.
        </p>
      ) : (
        <Inbox
          currentUserId={ctx.user.id}
          canReply={ctx.can("whatsapp:reply")}
          aiEnabled={ctx.can("ai:generate")}
          members={members.map((m) => ({ id: m.user.id, name: m.user.name }))}
        />
      )}
    </>
  );
}
