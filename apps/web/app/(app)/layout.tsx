import { isSuperAdmin, requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Aurora } from "@/components/app/aurora";
import { Sidebar } from "@/components/app/sidebar";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UserMenu } from "@/components/app/user-menu";
import { MAIN_NAV, MORE_NAV, ORG_NAV, WHATSAPP_NAV, type NavItem } from "@/components/app/nav";

/**
 * Every route here reads the signed-in session, so none of them may be
 * prerendered: a build has no request, and the session helpers reach for
 * runtime secrets that only exist on the running server. Marking the layout
 * dynamic keeps the whole group out of the static export.
 */
export const dynamic = "force-dynamic";


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
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/60 bg-background px-4 md:px-6">
          <div className="text-sm text-muted-foreground md:hidden">{ctx.organization.name}</div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserMenu
            user={{ name: ctx.user.name, email: ctx.user.email, image: ctx.user.image }}
            role={ctx.role ?? (ctx.actor.isSuperAdmin ? "SUPER ADMIN" : undefined)}
              impersonatedBy={ctx.impersonatedBy}
            />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
