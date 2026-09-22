"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Calendar,
  FileText,
  Home,
  Image,
  LayoutTemplate,
  Megaphone,
  MessageSquare,
  Palette,
  PenSquare,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavIcon, NavItem } from "./nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: Home,
  create: PenSquare,
  posts: FileText,
  calendar: Calendar,
  media: Image,
  ai: Sparkles,
  analytics: BarChart3,
  inbox: MessageSquare,
  contacts: Users2,
  templates: LayoutTemplate,
  campaigns: Megaphone,
  accounts: Plug,
  brand: Palette,
  team: Users,
  settings: Settings,
};

interface Props {
  main: NavItem[];
  more: NavItem[];
  /** Kept for callers that still pass the WhatsApp group; merged into "More". */
  whatsapp?: NavItem[];
  /** Kept for callers that still pass the organization group; merged into "More". */
  org?: NavItem[];
  isSuperAdmin: boolean;
  organizationName: string;
}

const LINK_BASE = "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      className={cn(
        LINK_BASE,
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

function visible(items: NavItem[]): NavItem[] {
  return items.filter((i) => !i.hidden);
}

export function Sidebar({ main, more, whatsapp = [], org = [], isSuperAdmin, organizationName }: Props) {
  const pathname = usePathname();
  const primary = visible(main);
  const secondary = [...visible(more), ...visible(whatsapp), ...visible(org)];
  const moreOpen = secondary.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <span className="truncate">{organizationName}</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <div className="grid gap-1">
          {primary.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
        {secondary.length > 0 && (
          <details open={moreOpen} className="mt-4 border-t pt-2">
            <summary className={cn(LINK_BASE, "cursor-pointer list-none text-sidebar-foreground/70 hover:bg-sidebar-accent/60")}>
              More
            </summary>
            <div className="mt-1 grid gap-1">
              {secondary.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </details>
        )}
        {isSuperAdmin && (
          <div className="mt-4 border-t pt-2">
            <Link
              href="/admin"
              className={cn(LINK_BASE, "text-sidebar-foreground/80 hover:bg-sidebar-accent/60")}
            >
              <ShieldCheck className="size-4" /> Super Admin
            </Link>
          </div>
        )}
      </nav>
    </aside>
  );
}
