"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Mount detection without an effect: the server snapshot is false, the client's is true. */
const subscribeNever = (): (() => void) => () => {};
import {
  BarChart3,
  Building2,
  ChevronDown,
  Brain,
  Calendar,
  FileText,
  Home,
  Image,
  LayoutTemplate,
  Megaphone,
  Menu,
  MessageSquare,
  Palette,
  PenSquare,
  Plug,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Users2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { UserMenu } from "@/components/app/user-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  memory: Brain,
  settings: Settings,
  admin: ShieldCheck,
};

export interface RailBudget {
  spentCents: number;
  budgetCents: number;
  activeRuns: number;
  maxActiveRuns: number;
}

interface Props {
  main: NavItem[];
  more: NavItem[];
  /** Kept for callers that still pass the WhatsApp group; merged into "More". */
  whatsapp?: NavItem[];
  /** Kept for callers that still pass the organization group; merged into "More". */
  org?: NavItem[];
  settings?: NavItem | null;
  isSuperAdmin: boolean;
  organizationName: string;
  /** Present when the viewer may see spend. */
  budget?: RailBudget | null;
  user: { name: string; email: string; image?: string | null; role?: string };
  /** Connected social accounts, shown under the organization name. */
  accountCount?: number;
  /** Set while a Super Admin is acting as this user. */
  impersonatedBy?: string | null;
  /** Campaigns waiting for a decision get the signal colour; everything else a quiet count. */
  urgentHrefs?: string[];
  /** Hidden when the viewer cannot start work. */
  canCreate?: boolean;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname, urgent = false }: { item: NavItem; pathname: string; urgent?: boolean }) {
  const active = isActive(pathname, item.href);
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[14px] transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-white"
          : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-white",
      )}
    >
      {active && <span aria-hidden className="absolute -left-4 top-2 h-5 w-[3px] rounded-r-full bg-signal" />}
      <Icon className={cn("size-[18px] shrink-0", active ? "text-white" : "text-sidebar-muted group-hover:text-white")} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center font-mono text-[11px] leading-5 font-medium tabular",
            urgent ? "bg-signal text-white" : "bg-white/15 text-white",
          )}
        >
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function money(cents: number): string {
  return cents >= 10_000 ? `$${Math.round(cents / 100)}` : `$${(cents / 100).toFixed(2)}`;
}

function BudgetCard({ budget }: { budget: RailBudget }) {
  const pct = budget.budgetCents > 0 ? Math.min(100, (budget.spentCents / budget.budgetCents) * 100) : 0;
  const tone = pct >= 90 ? "bg-red-400" : pct >= 75 ? "bg-amber-400" : "bg-white";
  const month = new Date().toLocaleDateString("en-US", { month: "long" });
  return (
    <Link
      href="/settings?tab=ai"
      className="block rounded-xl bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.07]"
      title="AI spend this month"
    >
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate text-sidebar-muted">Budget · {month.slice(0, 3)}</span>
        <span className="shrink-0 font-mono whitespace-nowrap text-white tabular">
          {money(budget.spentCents)} / {money(budget.budgetCents)}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-sidebar-muted">
        {budget.activeRuns > 0 && <span className="live-dot size-1.5 rounded-full bg-emerald-400" />}
        <span className="tabular">
          {budget.activeRuns} of {budget.maxActiveRuns} posts in progress
        </span>
      </div>
    </Link>
  );
}

function RailContent({
  main,
  more,
  whatsapp = [],
  org = [],
  settings,
  isSuperAdmin,
  organizationName,
  budget,
  user,
  canCreate = true,
  accountCount,
  impersonatedBy,
  urgentHrefs = [],
  pathname,
}: Props & { pathname: string }) {
  const primary = main.filter((i) => !i.hidden);
  const secondary = [...more, ...whatsapp, ...org].filter((i) => !i.hidden);
  const moreOpen = secondary.some((i) => isActive(pathname, i.href));

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-left outline-none hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-signal/60"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white font-display text-[13px] font-bold text-[#111316]">
              {initials(organizationName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[15px] leading-tight font-semibold text-white">{organizationName}</span>
              <span className="block truncate text-[12px] text-sidebar-muted capitalize">
                {[user.role?.toLowerCase(), accountCount !== undefined ? `${accountCount} account${accountCount === 1 ? "" : "s"}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Workspace</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/select-organization">
              <Building2 /> Switch organization
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/accounts">
              <Plug /> Connected accounts
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {canCreate && (
        <Link
          href="/home#compose"
          className="flex h-10 items-center justify-center gap-2 rounded-lg bg-sidebar-primary text-[14px] font-medium text-sidebar-primary-foreground transition-colors hover:bg-[#9a3412] focus-visible:ring-2 focus-visible:ring-signal/60 focus-visible:outline-none"
        >
          <Plus className="size-4" /> New post
        </Link>
      )}

      <nav aria-label="Main" className="-mx-1 flex-1 overflow-y-auto px-1">
        <div className="grid gap-0.5">
          {primary.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} urgent={urgentHrefs.includes(item.href)} />
          ))}
        </div>
        {secondary.length > 0 && (
          <details open={moreOpen} className="mt-4 border-t border-sidebar-border pt-3">
            <summary className="flex h-8 cursor-pointer list-none items-center px-3 text-[12px] font-medium tracking-wide text-sidebar-muted uppercase hover:text-white">
              More
            </summary>
            <div className="mt-1 grid gap-0.5">
              {secondary.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </details>
        )}
      </nav>

      {budget && <BudgetCard budget={budget} />}

      <div className="grid gap-0.5 border-t border-sidebar-border pt-3">
        {settings && !settings.hidden && <NavLink item={settings} pathname={pathname} />}
        {isSuperAdmin && (
          <NavLink item={{ href: "/admin", label: "Super Admin", icon: "admin" }} pathname={pathname} />
        )}
        <UserMenu user={user} role={user.role} impersonatedBy={impersonatedBy ?? null} variant="rail" />
      </div>
    </div>
  );
}

/** The dark rail on desktop. */
export function Sidebar(props: Props) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <RailContent {...props} pathname={pathname} />
    </aside>
  );
}

/** The same rail as a drawer below the md breakpoint. */
export function MobileNav(props: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  // Close the drawer when navigation lands somewhere new.
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    // The page behind a drawer should not scroll with it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const drawer = (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
      <aside className="relative h-full w-[280px] max-w-[85vw] overflow-y-auto bg-sidebar text-sidebar-foreground shadow-2xl">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
          className="absolute top-4 right-3 z-10 inline-flex size-8 items-center justify-center rounded-lg text-sidebar-muted hover:text-white"
        >
          <X className="size-4" />
        </button>
        <RailContent {...props} pathname={pathname} />
      </aside>
    </div>
  );

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-card"
      >
        <Menu className="size-4" />
      </button>
      {/*
       * Portalled to the body on purpose. The mobile header carries
       * backdrop-blur, and backdrop-filter makes an element the containing
       * block for its fixed descendants: rendered in place, this drawer's
       * inset-0 resolved to the 56px header, so the nav collapsed to nothing
       * and the backdrop covered only the header strip. The body has no such
       * ancestor. Mounted is checked because there is no document on the
       * server.
       */}
      {open && mounted && createPortal(drawer, document.body)}
    </div>
  );
}
