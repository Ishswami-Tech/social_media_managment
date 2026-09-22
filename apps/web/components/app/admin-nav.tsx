"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Building2, Cpu, Flag, HeartPulse, ListChecks, PackageX, Plug, ScrollText, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", label: "Overview", icon: Activity },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/integrations", label: "AI providers", icon: Cpu },
  { href: "/admin/usage", label: "Social integrations", icon: Plug },
  { href: "/admin/queues", label: "Queues & webhooks", icon: ListChecks },
  { href: "/admin/dead-letter", label: "Dead letters", icon: PackageX },
  { href: "/admin/provider-health", label: "Provider health", icon: HeartPulse },
  { href: "/admin/feature-flags", label: "Feature flags", icon: Flag },
  { href: "/admin/audit-logs", label: "Audit logs", icon: ScrollText },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex-1 p-2">
      {ITEMS.map((i) => {
        const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
              active ? "bg-sidebar-accent font-medium" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
            )}
          >
            <i.icon className="size-4" /> {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
