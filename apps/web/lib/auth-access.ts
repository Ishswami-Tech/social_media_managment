import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";
import { ORG_ROLES, type OrgRole } from "@platform/types";

/**
 * better-auth organization access control. This governs the plugin's own
 * endpoints (invite, remove member, update org...). Domain capabilities
 * (publish, approve, AI...) are enforced by @platform/rbac from member.role.
 */
export const ac = createAccessControl(defaultStatements);

const full = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

export const orgRoles = {
  OWNER: ac.newRole(full),
  ADMIN: ac.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["read"],
  }),
  MANAGER: ac.newRole({ invitation: ["create"], ac: ["read"] }),
  EDITOR: ac.newRole({ ac: ["read"] }),
  APPROVER: ac.newRole({ ac: ["read"] }),
  MEMBER: ac.newRole({ ac: ["read"] }),
  VIEWER: ac.newRole({ ac: ["read"] }),
} satisfies Record<OrgRole, unknown>;

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}
