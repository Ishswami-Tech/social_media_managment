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
  | "memory"
  | "settings"
  | "admin";

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
  /** Computed by the layout: a count that needs the user (waiting runs, unread chats). */
  badge?: number;
}

/**
 * The product is one loop: plan the month, let the agents write, approve, see
 * the results, and keep the AI's memory honest. Only that loop lives here.
 * Settings sits at the foot of the rail, not in this list.
 */
export const MAIN_NAV: NavItem[] = [
  { href: "/home", label: "Today", icon: "home" },
  { href: "/plan", label: "Plan", icon: "calendar", capability: "ai:generate" },
  { href: "/posts", label: "Posts", icon: "posts" },
  { href: "/whatsapp/inbox", label: "Inbox", icon: "inbox", capability: "whatsapp:view" },
  { href: "/analytics", label: "Results", icon: "analytics", capability: "analytics:view" },
  { href: "/memory", label: "Memory", icon: "memory", capability: "accounts:view" },
  { href: "/accounts", label: "Accounts", icon: "accounts", capability: "accounts:view" },
];

/** The rail's foot. */
export const SETTINGS_NAV: NavItem = { href: "/settings", label: "Settings", icon: "settings", capability: "org:settings" };

/**
 * Everything else, tucked behind a collapsed "More" group. The manual
 * composer, AI Studio and the rest of the WhatsApp module still exist at
 * their URLs but are not part of the product's front door.
 */
export const MORE_NAV: NavItem[] = [];

/** WhatsApp's inbox is in the main loop; the rest is reachable by URL. */
export const WHATSAPP_NAV: NavItem[] = [];

/** Team and Brand are tabs inside Settings now, so nothing is left here. */
export const ORG_NAV: NavItem[] = [];
