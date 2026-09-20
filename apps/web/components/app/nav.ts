import type { Capability } from "@platform/rbac";

/** Icon names are plain strings so nav items can cross the server/client boundary. */
export type NavIcon =
  | "dashboard"
  | "create"
  | "posts"
  | "calendar"
  | "media"
  | "ai"
  | "analytics"
  | "inbox"
  | "contacts"
  | "templates"
  | "campaigns"
  | "accounts"
  | "brand"
  | "team"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  capability?: Capability;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/create", label: "Create", icon: "create", capability: "content:create" },
  { href: "/posts", label: "Posts", icon: "posts" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/media", label: "Media", icon: "media" },
  { href: "/ai", label: "AI Studio", icon: "ai", capability: "ai:generate" },
  { href: "/analytics", label: "Analytics", icon: "analytics", capability: "analytics:view" },
];

export const WHATSAPP_NAV: NavItem[] = [
  { href: "/whatsapp/inbox", label: "Inbox", icon: "inbox", capability: "whatsapp:view" },
  { href: "/whatsapp/contacts", label: "Contacts", icon: "contacts", capability: "whatsapp:view" },
  { href: "/whatsapp/templates", label: "Templates", icon: "templates", capability: "whatsapp:view" },
  { href: "/whatsapp/campaigns", label: "Campaigns", icon: "campaigns", capability: "whatsapp:manage" },
];

export const ORG_NAV: NavItem[] = [
  { href: "/accounts", label: "Connected accounts", icon: "accounts", capability: "accounts:view" },
  { href: "/brand", label: "Brand", icon: "brand" },
  { href: "/team", label: "Team", icon: "team" },
  { href: "/settings", label: "Settings", icon: "settings", capability: "org:settings" },
];
