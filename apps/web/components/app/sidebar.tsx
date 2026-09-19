"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav";

interface Props {
  main: NavItem[];
  whatsapp: NavItem[];
  org: NavItem[];
  isSuperAdmin: boolean;
  organizationName: string;
}

function Section({ title, items, pathname }: { title?: string; items: NavItem[]; pathname: string }) {
  if (items.length === 0) return null;
  return (
    <div className="grid gap-1">
      {title && (
        <p className="px-3 pt-4 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      )}
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar({ main, whatsapp, org, isSuperAdmin, organizationName }: Props) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <span className="truncate">{organizationName}</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <Section items={main} pathname={pathname} />
        <Section title="WhatsApp" items={whatsapp} pathname={pathname} />
        <Section title="Organization" items={org} pathname={pathname} />
        {isSuperAdmin && (
          <div className="mt-4 border-t pt-2">
            <Link
              href="/admin"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
            >
              <ShieldCheck className="size-4" /> Super Admin
            </Link>
          </div>
        )}
      </nav>
    </aside>
  );
}
