import { isSuperAdmin, requireOrg } from "@/lib/session";
import { loadShellData } from "@/lib/home/overview";
import { MobileNav, Sidebar } from "@/components/app/sidebar";
import { prisma } from "@/lib/db";
import { MAIN_NAV, MORE_NAV, ORG_NAV, SETTINGS_NAV, WHATSAPP_NAV, type NavItem } from "@/components/app/nav";

/**
 * Every route here reads the signed-in session, so none of them may be
 * prerendered: a build has no request, and the session helpers reach for
 * runtime secrets that only exist on the running server. Marking the layout
 * dynamic keeps the whole group out of the static export.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const [shell, accountCount] = await Promise.all([
    loadShellData(ctx.organization.id, { withBudget: ctx.can("org:settings") }),
    prisma.socialAccount.count({ where: { organizationId: ctx.organization.id } }),
  ]);
  const badges: Record<string, number> = { "/home": shell.awaitingCount, "/whatsapp/inbox": shell.unreadCount };

  /** Capability gating, the organization-shape gate for WhatsApp, and attention badges. */
  const prepare = (items: NavItem[]): NavItem[] =>
    items
      .filter((i) => !i.capability || ctx.can(i.capability))
      .map((i) => ({ ...i, hidden: i.href.startsWith("/whatsapp") && !shell.hasWhatsApp, badge: badges[i.href] }));

  const role = ctx.role ?? (ctx.actor.isSuperAdmin ? "SUPER ADMIN" : undefined);
  const railProps = {
    main: prepare(MAIN_NAV),
    more: prepare(MORE_NAV),
    whatsapp: prepare(WHATSAPP_NAV),
    org: prepare(ORG_NAV),
    settings: prepare([SETTINGS_NAV])[0] ?? null,
    isSuperAdmin: isSuperAdmin(ctx.user),
    organizationName: ctx.organization.name,
    budget: shell.budget,
    user: { name: ctx.user.name, email: ctx.user.email, image: ctx.user.image, role },
    canCreate: ctx.can("ai:generate"),
    accountCount,
    impersonatedBy: ctx.impersonatedBy,
    urgentHrefs: ["/home"],
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar {...railProps} />
      <div className="relative flex h-screen min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Phones get the rail as a drawer; on larger screens the rail is always there and pages own their top row. */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur md:hidden">
          <MobileNav {...railProps} />
          <span className="truncate font-display text-[15px] font-semibold">{ctx.organization.name}</span>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8 md:py-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
