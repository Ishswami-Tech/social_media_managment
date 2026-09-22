import type { Capability } from "@platform/rbac";

/** Icon names are plain strings so nav items can cross the server/client boundary. */
export type NavIcon =
  | "home"
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
  /**
   * Computed by the layout (not by capabilities): the item is irrelevant for
   * this organization, e.g. the WhatsApp inbox with no WhatsApp number.
   */
  hidden?: boolean;
}

/** The five destinations that are always worth a click. */
export const MAIN_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/posts", label: "Posts", icon: "posts" },
  { href: "/whatsapp/inbox", label: "Inbox", icon: "inbox", capability: "whatsapp:view" },
  { href: "/accounts", label: "Accounts", icon: "accounts", capability: "accounts:view" },
  { href: "/settings", label: "Settings", icon: "settings", capability: "org:settings" },
];

/** Everything else, tucked behind a collapsed "More" group. */
export const MORE_NAV: NavItem[] = [
  { href: "/create", label: "Write it yourself", icon: "create", capability: "content:create" },
  { href: "/ai", label: "AI Studio", icon: "ai", capability: "ai:generate" },
  { href: "/analytics", label: "Analytics", icon: "analytics", capability: "analytics:view" },
];

/** WhatsApp beyond the inbox; also shown inside "More". */
export const WHATSAPP_NAV: NavItem[] = [
  { href: "/whatsapp/contacts", label: "WhatsApp contacts", icon: "contacts", capability: "whatsapp:view" },
  { href: "/whatsapp/templates", label: "WhatsApp templates", icon: "templates", capability: "whatsapp:view" },
  { href: "/whatsapp/campaigns", label: "WhatsApp campaigns", icon: "campaigns", capability: "whatsapp:manage" },
];

/** Team and Brand are tabs inside Settings now, so nothing is left here. */
export const ORG_NAV: NavItem[] = [];
