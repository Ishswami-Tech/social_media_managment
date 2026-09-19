import type { OrgRole } from "@platform/types";

/**
 * Fine-grained capabilities. The permission matrix (spec §4.9) maps roles to
 * a default level for each; organizations can widen a few "Configured"
 * capabilities via OrgPermissionOverrides (e.g. let Editors publish).
 */
export const CAPABILITIES = [
  "platform:manage",
  "org:settings",
  "org:members",
  "org:billing",
  "org:transfer_ownership",
  "accounts:connect",
  "accounts:view",
  "content:create",
  "content:edit_any",
  "content:delete",
  "content:approve",
  "content:publish",
  "ai:generate",
  "ai:image",
  "media:upload",
  "whatsapp:view",
  "whatsapp:reply",
  "whatsapp:manage",
  "analytics:view",
  "audit:view",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** "FULL" always allowed, "NO" never, "CONFIGURED" allowed only if the org enables it for that role. */
export type Grant = "FULL" | "NO" | "CONFIGURED";

type Matrix = Record<OrgRole, Record<Capability, Grant>>;

const F: Grant = "FULL";
const N: Grant = "NO";
const C: Grant = "CONFIGURED";

export const ROLE_MATRIX: Matrix = {
  OWNER: {
    "platform:manage": N,
    "org:settings": F,
    "org:members": F,
    "org:billing": F,
    "org:transfer_ownership": F,
    "accounts:connect": F,
    "accounts:view": F,
    "content:create": F,
    "content:edit_any": F,
    "content:delete": F,
    "content:approve": F,
    "content:publish": F,
    "ai:generate": F,
    "ai:image": F,
    "media:upload": F,
    "whatsapp:view": F,
    "whatsapp:reply": F,
    "whatsapp:manage": F,
    "analytics:view": F,
    "audit:view": F,
  },
  ADMIN: {
    "platform:manage": N,
    "org:settings": F,
    "org:members": F,
    "org:billing": N,
    "org:transfer_ownership": N,
    "accounts:connect": F,
    "accounts:view": F,
    "content:create": F,
    "content:edit_any": F,
    "content:delete": F,
    "content:approve": F,
    "content:publish": F,
    "ai:generate": F,
    "ai:image": F,
    "media:upload": F,
    "whatsapp:view": F,
    "whatsapp:reply": F,
    "whatsapp:manage": F,
    "analytics:view": F,
    "audit:view": F,
  },
  MANAGER: {
    "platform:manage": N,
    "org:settings": N,
    "org:members": C,
    "org:billing": N,
    "org:transfer_ownership": N,
    "accounts:connect": C,
    "accounts:view": F,
    "content:create": F,
    "content:edit_any": F,
    "content:delete": F,
    "content:approve": F,
    "content:publish": C,
    "ai:generate": F,
    "ai:image": F,
    "media:upload": F,
    "whatsapp:view": C,
    "whatsapp:reply": C,
    "whatsapp:manage": N,
    "analytics:view": F,
    "audit:view": N,
  },
  EDITOR: {
    "platform:manage": N,
    "org:settings": N,
    "org:members": N,
    "org:billing": N,
    "org:transfer_ownership": N,
    "accounts:connect": C,
    "accounts:view": F,
    "content:create": F,
    "content:edit_any": N,
    "content:delete": N,
    "content:approve": N,
    "content:publish": C,
    "ai:generate": F,
    "ai:image": F,
    "media:upload": F,
    "whatsapp:view": C,
    "whatsapp:reply": C,
    "whatsapp:manage": N,
    "analytics:view": F,
    "audit:view": N,
  },
  APPROVER: {
    "platform:manage": N,
    "org:settings": N,
    "org:members": N,
    "org:billing": N,
    "org:transfer_ownership": N,
    "accounts:connect": N,
    "accounts:view": F,
    "content:create": N,
    "content:edit_any": N,
    "content:delete": N,
    "content:approve": F,
    "content:publish": N,
    "ai:generate": C,
    "ai:image": N,
    "media:upload": N,
    "whatsapp:view": N,
    "whatsapp:reply": N,
    "whatsapp:manage": N,
    "analytics:view": F,
    "audit:view": N,
  },
  MEMBER: {
    "platform:manage": N,
    "org:settings": N,
    "org:members": N,
    "org:billing": N,
    "org:transfer_ownership": N,
    "accounts:connect": N,
    "accounts:view": F,
    "content:create": C,
    "content:edit_any": N,
    "content:delete": N,
    "content:approve": N,
    "content:publish": N,
    "ai:generate": C,
    "ai:image": C,
    "media:upload": C,
    "whatsapp:view": C,
    "whatsapp:reply": N,
    "whatsapp:manage": N,
    "analytics:view": F,
    "audit:view": N,
  },
  VIEWER: {
    "platform:manage": N,
    "org:settings": N,
    "org:members": N,
    "org:billing": N,
    "org:transfer_ownership": N,
    "accounts:connect": N,
    "accounts:view": F,
    "content:create": N,
    "content:edit_any": N,
    "content:delete": N,
    "content:approve": N,
    "content:publish": N,
    "ai:generate": N,
    "ai:image": N,
    "media:upload": N,
    "whatsapp:view": C,
    "whatsapp:reply": N,
    "whatsapp:manage": N,
    "analytics:view": F,
    "audit:view": N,
  },
};

/**
 * Per-organization overrides for CONFIGURED capabilities. Stored as JSON on
 * Organization.settings.permissions. Keys are roles; values are the list of
 * CONFIGURED capabilities the org has enabled for that role.
 */
export type OrgPermissionOverrides = Partial<Record<OrgRole, Capability[]>>;

export const DEFAULT_OVERRIDES: OrgPermissionOverrides = {
  MANAGER: ["content:publish", "whatsapp:view", "whatsapp:reply", "accounts:connect"],
  EDITOR: ["whatsapp:view"],
  MEMBER: ["content:create", "ai:generate", "media:upload", "whatsapp:view"],
  VIEWER: ["whatsapp:view"],
};

export interface Actor {
  userId: string;
  isSuperAdmin?: boolean;
  /** Role in the organization being acted on. undefined = not a member. */
  role?: OrgRole;
}

export interface CanOptions {
  overrides?: OrgPermissionOverrides;
  /**
   * Super admins get "Support" access to organization capabilities (spec §4.9).
   * Set false to evaluate a super admin strictly as an org member (used when
   * impersonation is disabled by policy).
   */
  allowSuperAdminSupport?: boolean;
}

export function can(actor: Actor, capability: Capability, opts: CanOptions = {}): boolean {
  if (capability === "platform:manage") return actor.isSuperAdmin === true;
  if (actor.isSuperAdmin && opts.allowSuperAdminSupport !== false) {
    // Super admin support access never includes billing or ownership transfer.
    return capability !== "org:billing" && capability !== "org:transfer_ownership";
  }
  if (!actor.role) return false;
  const grant = ROLE_MATRIX[actor.role][capability];
  if (grant === "FULL") return true;
  if (grant === "NO") return false;
  const overrides = opts.overrides ?? DEFAULT_OVERRIDES;
  return overrides[actor.role]?.includes(capability) ?? false;
}

export class ForbiddenError extends Error {
  constructor(public readonly capability: Capability) {
    super(`Forbidden: missing capability ${capability}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(actor: Actor, capability: Capability, opts?: CanOptions): void {
  if (!can(actor, capability, opts)) throw new ForbiddenError(capability);
}

/** Roles ordered from most to least privileged; used for "can assign role X" checks. */
export const ROLE_RANK: Record<OrgRole, number> = {
  OWNER: 100,
  ADMIN: 80,
  MANAGER: 60,
  EDITOR: 40,
  APPROVER: 40,
  MEMBER: 20,
  VIEWER: 10,
};

/**
 * Can `actor` assign `target` role to someone? Owners can assign anything
 * (including OWNER, which is a transfer). Admins can assign anything below
 * OWNER. Managers with org:members can only assign EDITOR/APPROVER/MEMBER/VIEWER.
 */
export function canAssignRole(actor: Actor, target: OrgRole, opts?: CanOptions): boolean {
  if (actor.isSuperAdmin && opts?.allowSuperAdminSupport !== false) return target !== "OWNER";
  if (!can(actor, "org:members", opts)) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "ADMIN") return target !== "OWNER";
  return ROLE_RANK[target] < ROLE_RANK["MANAGER"];
}

/** Capabilities the role has (including CONFIGURED ones enabled by overrides). */
export function capabilitiesFor(actor: Actor, opts?: CanOptions): Capability[] {
  return CAPABILITIES.filter((c) => can(actor, c, opts));
}
