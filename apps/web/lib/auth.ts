import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { writeAudit } from "@platform/database";
import { ac, orgRoles } from "./auth-access";
import { prisma } from "./db";
import { getEnv } from "./env";
import { sendEmail } from "./email";

/**
 * better-auth configuration.
 * - Email/password authentication with 14-day sessions.
 * - `admin` plugin: users with role "admin" are platform Super Admins; it also
 *   provides ban/unban and audited impersonation.
 * - `organization` plugin: tenants, memberships, invitations and the active
 *   organization stored on the session. Roles use the spec's names.
 */
/**
 * APP_URL plus anything in TRUSTED_ORIGINS, each an origin with no trailing
 * slash and no duplicates. Sign-in from an untrusted origin is refused, which
 * is how a working deployment reached by a second hostname stops being able
 * to log anyone in.
 */
export function trustedOrigins(appUrl: string, extra: string | undefined): string[] {
  const asOrigin = (value: string): string | undefined => {
    try {
      return new URL(value.trim()).origin;
    } catch {
      return undefined;
    }
  };
  const all = [appUrl, ...(extra ?? "").split(",")].map(asOrigin).filter((o): o is string => Boolean(o));
  return [...new Set(all)];
}

function buildAuth() {
  const env = getEnv();
  return betterAuth({
    appName: "Social AI Platform",
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    trustedOrigins: trustedOrigins(env.APP_URL, env.TRUSTED_ORIGINS),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      // Short cache so role changes, bans and org suspensions propagate within a minute.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    rateLimit: { enabled: env.NODE_ENV === "production", window: 60, max: 100 },
    user: {
      additionalFields: {
        status: { type: "string", required: false, defaultValue: "ACTIVE", input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            const impersonatedBy = (session as { impersonatedBy?: string | null }).impersonatedBy;
            if (impersonatedBy) {
              await writeAudit(prisma, {
                actorUserId: impersonatedBy,
                impersonatorId: impersonatedBy,
                action: "admin.impersonate.start",
                resourceType: "User",
                resourceId: session.userId,
                ipAddress: session.ipAddress,
                userAgent: session.userAgent,
              });
            }
            // A fresh session has no active organization. Point it at one the
            // user already belongs to; only a brand-new user gets a default one.
            const current = (session as { activeOrganizationId?: string | null }).activeOrganizationId;
            if (!current) {
              const membership = await prisma.member.findFirst({
                where: { userId: session.userId, status: "ACTIVE" },
                orderBy: { createdAt: "asc" },
                select: { organizationId: true },
              });
              const organizationId = membership?.organizationId ?? (await createDefaultOrganization(session.userId));
              if (organizationId) {
                await prisma.session.update({
                  where: { id: session.id },
                  data: { activeOrganizationId: organizationId },
                });
              }
            }
          },
        },
      },
      user: {
        create: {
          after: async (user) => {
            await writeAudit(prisma, {
              actorUserId: user.id,
              action: "user.register",
              resourceType: "User",
              resourceId: user.id,
            });
          },
        },
      },
    },
    plugins: [
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
        impersonationSessionDuration: 60 * 60,
      }),
      organization({
        ac,
        roles: orgRoles,
        creatorRole: "OWNER",
        invitationExpiresIn: 60 * 60 * 24 * 7,
        cancelPendingInvitationsOnReInvite: true,
        schema: {
          organization: {
            additionalFields: {
              status: { type: "string", required: false, defaultValue: "ACTIVE", input: false },
              planId: { type: "string", required: false, input: false },
            },
          },
          member: {
            additionalFields: {
              status: { type: "string", required: false, defaultValue: "ACTIVE", input: false },
            },
          },
        },
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, user }) => {
            const freePlan = await prisma.plan.findUnique({ where: { slug: "free" } });
            await prisma.organization.update({ where: { id: org.id }, data: { planId: freePlan?.id ?? null } });
            await prisma.organizationSettings.upsert({
              where: { organizationId: org.id },
              create: { organizationId: org.id },
              update: {},
            });
            await writeAudit(prisma, {
              organizationId: org.id,
              actorUserId: user.id,
              action: "organization.create",
              resourceType: "Organization",
              resourceId: org.id,
              metadata: { name: org.name, slug: org.slug },
            });
          },
          afterAddMember: async ({ member, user }) => {
            await writeAudit(prisma, {
              organizationId: member.organizationId,
              actorUserId: user.id,
              action: "member.add",
              resourceType: "Member",
              resourceId: member.id,
              metadata: { role: member.role },
            });
          },
          afterRemoveMember: async ({ member, user }) => {
            await writeAudit(prisma, {
              organizationId: member.organizationId,
              actorUserId: user.id,
              action: "member.remove",
              resourceType: "Member",
              resourceId: member.id,
            });
          },
          afterUpdateMemberRole: async ({ member, previousRole, user }) => {
            await writeAudit(prisma, {
              organizationId: member.organizationId,
              actorUserId: user.id,
              action: "member.role_change",
              resourceType: "Member",
              resourceId: member.id,
              metadata: { from: previousRole, to: member.role },
            });
          },
        },
        sendInvitationEmail: async (data) => {
          const link = `${env.APP_URL}/accept-invitation/${data.id}`;
          const inviter = data.inviter.user.name;
          const org = data.organization.name;
          await sendEmail({
            to: data.email,
            subject: `You're invited to ${org}`,
            text: `${inviter} invited you to join ${org} as ${data.role}.\n\nAccept the invitation: ${link}\n\nThis link expires in 7 days.`,
            html: `<p>${inviter} invited you to join <strong>${org}</strong> as ${data.role}.</p><p><a href="${link}">Accept the invitation</a></p><p>This link expires in 7 days.</p>`,
          });
        },
      }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof buildAuth>;

declare global {
  var __platformAuth: Auth | undefined;
}

export function getAuth(): Auth {
  if (!globalThis.__platformAuth) globalThis.__platformAuth = buildAuth();
  return globalThis.__platformAuth;
}

/**
 * Lazy better-auth instance: construction (which validates the environment)
 * is deferred to first use so route collection at build time never needs
 * secrets. All property access is forwarded to the real instance.
 */
/** First sign-in of a user with no organization: one is made for them, named after them. */
async function createDefaultOrganization(userId: string): Promise<string | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, id: true } });
  if (!user) return undefined;
  const slug = `org-${user.id.slice(0, 8)}`;
  const org = await prisma.organization.upsert({
    where: { slug },
    update: { members: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } } },
    create: {
      name: `${user.name ?? "My"} Organization`,
      slug,
      status: "ACTIVE",
      members: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
      settings: { create: {} },
    },
    select: { id: true },
  });
  return org.id;
}

export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    // Framework/runtime probes (thenable checks, React element checks, serialisation)
    // must not instantiate the real client.
    if (
      typeof prop === "symbol" ||
      prop === "then" ||
      prop === "toJSON" ||
      prop === "$$typeof" ||
      prop === "__esModule" ||
      prop === "default"
    )
      return undefined;
    const real = getAuth();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

export type Session = Auth["$Infer"]["Session"];
export type AuthUser = Session["user"];
