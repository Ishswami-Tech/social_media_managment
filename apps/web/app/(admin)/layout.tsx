import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/lib/session";
import { AdminNav } from "@/components/app/admin-nav";
import { UserMenu } from "@/components/app/user-menu";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSuperAdmin();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
          <ShieldCheck className="size-5" /> Super Admin
        </div>
        <AdminNav />
        <div className="border-t p-2">
          <Link
            href="/home"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
          >
            <ArrowLeft className="size-4" /> Back to app
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-end border-b bg-background/80 px-6 backdrop-blur">
          <UserMenu
            user={{ name: session.user.name, email: session.user.email, image: session.user.image }}
            role="SUPER ADMIN"
            impersonatedBy={null}
          />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
