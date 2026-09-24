import { isSuperAdmin, requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Aurora } from "@/components/app/aurora";
import { Sidebar } from "@/components/app/sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { MAIN_NAV, MORE_NAV, ORG_NAV, WHATSAPP_NAV, type NavItem } from "@/components/app/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const whatsAppAccounts = await prisma.whatsAppAccount.count({ where: { organizationId: ctx.organization.id } });
  const hasWhatsApp = whatsAppAccounts > 0;
  /** Capability gating plus the organization-shape gate for WhatsApp destinations. */
  const prepare = (items: NavItem[]): NavItem[] =>
    items
      .filter((i) => !i.capability || ctx.can(i.capability))
      .map((i) => ({ ...i, hidden: i.href.startsWith("/whatsapp") && !hasWhatsApp }));

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        main={prepare(MAIN_NAV)}
        more={prepare(MORE_NAV)}
        whatsapp={prepare(WHATSAPP_NAV)}
        org={prepare(ORG_NAV)}
        isSuperAdmin={isSuperAdmin(ctx.user)}
        organizationName={ctx.organization.name}
      />
      <div className="relative flex h-screen min-w-0 flex-1 flex-col overflow-y-auto">
        <Aurora />
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl md:px-6">
          <div className="text-sm text-muted-foreground md:hidden">{ctx.organization.name}</div>
          <div className="hidden md:block" />
          <UserMenu
            user={{ name: ctx.user.name, email: ctx.user.email, image: ctx.user.image }}
            role={ctx.role ?? (ctx.actor.isSuperAdmin ? "SUPER ADMIN" : undefined)}
            impersonatedBy={ctx.impersonatedBy}
          />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
