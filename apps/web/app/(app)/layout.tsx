import { requireOrg } from "@/lib/session";
import { isSuperAdmin } from "@/lib/session";
import { Sidebar } from "@/components/app/sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { MAIN_NAV, ORG_NAV, WHATSAPP_NAV } from "@/components/app/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const filter = (items: typeof MAIN_NAV) => items.filter((i) => !i.capability || ctx.can(i.capability));
  return (
    <div className="flex min-h-screen">
      <Sidebar
        main={filter(MAIN_NAV)}
        whatsapp={filter(WHATSAPP_NAV)}
        org={filter(ORG_NAV)}
        isSuperAdmin={isSuperAdmin(ctx.user)}
        organizationName={ctx.organization.name}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur md:px-6">
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
