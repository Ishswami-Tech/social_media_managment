import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  can,
  DEFAULT_OVERRIDES,
  ForbiddenError,
  type Actor,
  type Capability,
  type OrgPermissionOverrides,
} from "@platform/rbac";
import type { OrgRole } from "@platform/types";
import { auth, type Session } from "./auth";
import { isOrgRole } from "./auth-access";
import { prisma } from "./db";

export async function getSession(): Promise<Session | null> {
  return auth.api.getSession({ headers: await headers() });
}

export function isSuperAdmin(user: Session["user"] | null | undefined): boolean {
  return (user as { role?: string | null } | undefined)?.role === "admin";
}

export interface OrgContext {
  session: Session;
  user: Session["user"];
  organization: { id: string; name: string; slug: string; status: string; planId: string | null };
  role: OrgRole | undefined;
  actor: Actor;
  overrides: OrgPermissionOverrides;
  settings: {
    timezone: string;
    requireApproval: boolean;
    whatsappRequireHumanApproval: boolean;
    aiDefaultProvider: string | null;
    aiDefaultModel: string | null;
    aiImageProvider: string | null;
    aiImageModel: string | null;
  };
  impersonatedBy: string | null;
  can: (capability: Capability) => boolean;
}

/**
 * Resolve the caller's active organization (from the better-auth session) and
 * their role in it. Super admins get support access to any organization even
 * without a membership (spec §4.9), which is always audited by the callers.
 */
export async function getOrgContext(session?: Session | null): Promise<OrgContext | null> {
  const s = session === undefined ? await getSession() : session;
  if (!s) return null;
  const activeOrganizationId = (s.session as { activeOrganizationId?: string | null }).activeOrganizationId;
  if (!activeOrganizationId) return null;
  const superAdmin = isSuperAdmin(s.user);
  const [org, member] = await Promise.all([
    prisma.organization.findUnique({ where: { id: activeOrganizationId }, include: { settings: true } }),
    prisma.member.findUnique({
      where: { organizationId_userId: { organizationId: activeOrganizationId, userId: s.user.id } },
    }),
  ]);
  if (!org) return null;
  if (!member && !superAdmin) return null;
  if (member?.status === "SUSPENDED") return null;
  if (org.status !== "ACTIVE" && !superAdmin) return null;
  const role = member && isOrgRole(member.role) ? member.role : undefined;
  const overrides = ((org.settings?.permissionOverrides as OrgPermissionOverrides | null) ??
    DEFAULT_OVERRIDES) as OrgPermissionOverrides;
  const actor: Actor = { userId: s.user.id, isSuperAdmin: superAdmin, role };
  const settings = org.settings ?? {
    timezone: "UTC",
    requireApproval: true,
    whatsappRequireHumanApproval: true,
    aiDefaultProvider: null,
    aiDefaultModel: null,
    aiImageProvider: null,
    aiImageModel: null,
  };
  return {
    session: s,
    user: s.user,
    organization: { id: org.id, name: org.name, slug: org.slug, status: org.status, planId: org.planId },
    role,
    actor,
    overrides,
    settings: {
      timezone: settings.timezone,
      requireApproval: settings.requireApproval,
      whatsappRequireHumanApproval: settings.whatsappRequireHumanApproval,
      aiDefaultProvider: settings.aiDefaultProvider,
      aiDefaultModel: settings.aiDefaultModel,
      aiImageProvider: settings.aiImageProvider,
      aiImageModel: settings.aiImageModel,
    },
    impersonatedBy: (s.session as { impersonatedBy?: string | null }).impersonatedBy ?? null,
    can: (capability) => can(actor, capability, { overrides }),
  };
}

// ---- Page helpers (redirect) ----

export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireOrg(): Promise<OrgContext> {
  const s = await requireUser();
  const ctx = await getOrgContext(s);
  if (!ctx) redirect("/select-organization");
  return ctx;
}

export async function requireCapability(capability: Capability | Capability[]): Promise<OrgContext> {
  const ctx = await requireOrg();
  const any = Array.isArray(capability) ? capability : [capability];
  if (!any.some((c) => ctx.can(c))) redirect("/home?forbidden=" + encodeURIComponent(any[0]!));
  return ctx;
}

export async function requireSuperAdmin(): Promise<Session> {
  const s = await requireUser();
  if (!isSuperAdmin(s.user)) redirect("/home");
  return s;
}

// ---- API helpers (throw) ----

export function assertCapability(ctx: OrgContext, capability: Capability): void {
  if (!ctx.can(capability)) throw new ForbiddenError(capability);
}
