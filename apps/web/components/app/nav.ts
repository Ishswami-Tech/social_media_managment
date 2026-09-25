import type { Capability } from "@platform/rbac";

/** Icon names are plain strings so nav items can cross the server/client boundary. */
export type NavIcon =
  | "home"
  | "agents"
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

/**
 * The product is one loop: plan the month, let the agents write, approve, see
 * the results, and keep the AI's memory honest. Only that loop lives here.
 */
export const MAIN_NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/agents", label: "Agents", icon: "agents", capability: "accounts:view" },
  { href: "/plan", label: "Plan", icon: "calendar", capability: "ai:generate" },
  { href: "/posts", label: "Posts", icon: "posts" },
  { href: "/memory", label: "Memory", icon: "memory", capability: "accounts:view" },
  { href: "/accounts", label: "Accounts", icon: "accounts", capability: "accounts:view" },
  { href: "/settings", label: "Settings", icon: "settings", capability: "org:settings" },
];

/**
 * Everything else, tucked behind a collapsed "More" group. The manual
 * composer, AI Studio and the WhatsApp module still exist at their URLs but
 * are not part of the product's front door: the agents write, you approve.
 */
export const MORE_NAV: NavItem[] = [
  { href: "/analytics", label: "Analytics", icon: "analytics", capability: "analytics:view" },
];

/** WhatsApp is reachable by URL only until it earns a place in the loop. */
export const WHATSAPP_NAV: NavItem[] = [];

/** Team and Brand are tabs inside Settings now, so nothing is left here. */
export const ORG_NAV: NavItem[] = [];
