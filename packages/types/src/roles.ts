/**
 * Organization-level roles. Super Admin is deliberately NOT here: it is a
 * platform-level flag on the user (`User.isSuperAdmin`), not an org membership.
 */
export const ORG_ROLES = ["OWNER", "ADMIN", "MANAGER", "EDITOR", "APPROVER", "MEMBER", "VIEWER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const MEMBER_STATUSES = ["ACTIVE", "INVITED", "SUSPENDED"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const ORG_STATUSES = ["ACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];
