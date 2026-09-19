import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Calendar,
  Image,
  LayoutDashboard,
  MessageSquare,
  Palette,
  PenSquare,
  Plug,
  Settings,
  Sparkles,
  Users,
  Users2,
  FileText,
  LayoutTemplate,
  Megaphone,
} from "lucide-react";
import type { Capability } from "@platform/rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  capability?: Capability;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/create", label: "Create", icon: PenSquare, capability: "content:create" },
  { href: "/posts", label: "Posts", icon: FileText },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/media", label: "Media", icon: Image },
  { href: "/ai", label: "AI Studio", icon: Sparkles, capability: "ai:generate" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, capability: "analytics:view" },
];

export const WHATSAPP_NAV: NavItem[] = [
  { href: "/whatsapp/inbox", label: "Inbox", icon: MessageSquare, capability: "whatsapp:view" },
  { href: "/whatsapp/contacts", label: "Contacts", icon: Users2, capability: "whatsapp:view" },
  { href: "/whatsapp/templates", label: "Templates", icon: LayoutTemplate, capability: "whatsapp:view" },
  { href: "/whatsapp/campaigns", label: "Campaigns", icon: Megaphone, capability: "whatsapp:manage" },
];

export const ORG_NAV: NavItem[] = [
  { href: "/accounts", label: "Connected accounts", icon: Plug, capability: "accounts:view" },
  { href: "/brand", label: "Brand", icon: Palette },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings, capability: "org:settings" },
];
