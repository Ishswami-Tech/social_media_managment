import { generateCodeVerifier, generateState, type ConnectedAccount } from "@platform/social-core";
import { saveSocialCredential } from "@platform/database";
import type { ProviderFamily } from "@platform/types";
import { ApiError, badRequest } from "../errors";
import { audit } from "../audit";
import { keyring, prisma } from "../db";
import { getEnv } from "../env";
import { FAMILY_ENTRY_PLATFORM, providers } from "../providers";
import type { OrgContext } from "../session";

const STATE_TTL_MS = 10 * 60_000;

export function callbackUrl(family: ProviderFamily): string {
  return `${getEnv().APP_URL}/api/oauth/${family.toLowerCase()}/callback`;
}

/** Step 1: create a CSRF state bound to org + user and redirect to the provider. */
export async function startConnect(ctx: OrgContext, family: ProviderFamily, redirectTo = "/accounts"): Promise<string> {
  const platform = FAMILY_ENTRY_PLATFORM[family];
  if (!platform || !providers().has(platform))
    throw new ApiError(503, `${family} integration is not configured`, "provider_unavailable");
  const provider = providers().get(platform);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  await prisma.oAuthState.create({
    data: {
      state,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
      provider: family,
      codeVerifier,
      redirectTo,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  const { url } = await provider.getAuthorizationUrl(callbackUrl(family), state, { codeVerifier });
  await audit(ctx, "account.connect.start", "SocialAccount", null, { family });
  return url;
}

export interface ConnectResult {
  organizationId: string;
  redirectTo: string;
  connected: { id: string; platform: string; displayName: string }[];
}

/** Step 2: validate state, exchange the code, persist every discovered account with encrypted tokens. */
export async function completeConnect(
  family: ProviderFamily,
  params: { code?: string | null; state?: string | null; error?: string | null },
): Promise<ConnectResult> {
  if (params.error) throw badRequest(`Provider returned an error: ${params.error}`);
  if (!params.code || !params.state) throw badRequest("Missing code or state");
  const stored = await prisma.oAuthState.findUnique({ where: { state: params.state } });
  if (!stored || stored.provider !== family) throw badRequest("Invalid OAuth state");
  await prisma.oAuthState.delete({ where: { id: stored.id } }); // single use
  if (stored.expiresAt.getTime() < Date.now()) throw badRequest("OAuth state expired; please try again");

  const platform = FAMILY_ENTRY_PLATFORM[family]!;
  const provider = providers().get(platform);
  const accounts = await provider.handleCallback({
    code: params.code,
    state: params.state,
    codeVerifier: stored.codeVerifier ?? undefined,
    redirectUri: callbackUrl(family),
  });
  const connected: ConnectResult["connected"] = [];
  for (const acct of accounts) connected.push(await persistAccount(stored.organizationId, stored.userId, acct));
  await prisma.auditLog.create({
    data: {
      organizationId: stored.organizationId,
      actorUserId: stored.userId,
      action: "account.connect.complete",
      resourceType: "SocialAccount",
      metadata: { family, accounts: connected.map((c) => `${c.platform}:${c.displayName}`) },
    },
  });
  return { organizationId: stored.organizationId, redirectTo: stored.redirectTo ?? "/accounts", connected };
}

export async function persistAccount(organizationId: string, userId: string, acct: ConnectedAccount) {
  const row = await prisma.socialAccount.upsert({
    where: {
      organizationId_platform_externalAccountId: {
        organizationId,
        platform: acct.platform,
        externalAccountId: acct.externalAccountId,
      },
    },
    create: {
      organizationId,
      platform: acct.platform,
      accountType: acct.accountType,
      externalAccountId: acct.externalAccountId,
      username: acct.username,
      displayName: acct.displayName,
      avatarUrl: acct.avatarUrl,
      profileUrl: acct.profileUrl,
      status: "CONNECTED",
      capabilities: acct.capabilities as object,
      metadata: (acct.metadata ?? {}) as object,
      connectedById: userId,
      lastSyncedAt: new Date(),
    },
    update: {
      username: acct.username,
      displayName: acct.displayName,
      avatarUrl: acct.avatarUrl,
      profileUrl: acct.profileUrl,
      status: "CONNECTED",
      capabilities: acct.capabilities as object,
      metadata: (acct.metadata ?? {}) as object,
      lastSyncedAt: new Date(),
      lastError: null,
    },
  });
  await saveSocialCredential(prisma, keyring(), row.id, {
    accessToken: acct.credential.accessToken,
    refreshToken: acct.credential.refreshToken,
    expiresAt: acct.credential.expiresAt,
    refreshExpiresAt: acct.credential.refreshExpiresAt,
    scopes: acct.credential.scopes,
    metadata: acct.credential.secretMetadata,
  });
  return { id: row.id, platform: row.platform, displayName: row.displayName };
}

export async function disconnectAccount(ctx: OrgContext, socialAccountId: string) {
  const acct = await prisma.socialAccount.findFirst({
    where: { id: socialAccountId, organizationId: ctx.organization.id },
  });
  if (!acct) throw new ApiError(404, "Account not found", "not_found");
  await prisma.$transaction([
    prisma.socialCredential.deleteMany({ where: { socialAccountId } }),
    prisma.socialAccount.update({ where: { id: socialAccountId }, data: { status: "DISCONNECTED" } }),
    prisma.postVariant.updateMany({
      where: { socialAccountId, status: { in: ["SCHEDULED", "QUEUED", "APPROVED"] } },
      data: { status: "DISCONNECTED_ACCOUNT" },
    }),
  ]);
  await audit(ctx, "account.disconnect", "SocialAccount", socialAccountId, {
    platform: acct.platform,
    displayName: acct.displayName,
  });
}
