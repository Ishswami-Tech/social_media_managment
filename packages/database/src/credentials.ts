import type { Keyring } from "@platform/encryption";
import type { PrismaClient } from "./generated/prisma/client";

export interface DecryptedCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  metadata?: Record<string, unknown>;
}

export interface CredentialInput {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  scopes?: string[];
  metadata?: Record<string, unknown> | null;
}

/** AAD binds the ciphertext to the account so a row copied between accounts cannot be decrypted. */
const aad = (socialAccountId: string) => `social-credential:${socialAccountId}`;

export async function saveSocialCredential(
  client: Pick<PrismaClient, "socialCredential">,
  keyring: Keyring,
  socialAccountId: string,
  input: CredentialInput,
) {
  const data = {
    accessTokenEncrypted: keyring.encrypt(input.accessToken, aad(socialAccountId)),
    refreshTokenEncrypted: input.refreshToken ? keyring.encrypt(input.refreshToken, aad(socialAccountId)) : null,
    expiresAt: input.expiresAt ?? null,
    refreshExpiresAt: input.refreshExpiresAt ?? null,
    scopes: input.scopes ?? [],
    metadataEncrypted: input.metadata ? keyring.encryptJson(input.metadata, aad(socialAccountId)) : null,
    rotatedAt: new Date(),
  };
  return client.socialCredential.upsert({
    where: { socialAccountId },
    create: { socialAccountId, ...data },
    update: data,
  });
}

export async function loadSocialCredential(
  client: Pick<PrismaClient, "socialCredential">,
  keyring: Keyring,
  socialAccountId: string,
): Promise<DecryptedCredential | null> {
  const row = await client.socialCredential.findUnique({ where: { socialAccountId } });
  if (!row) return null;
  return {
    accessToken: keyring.decrypt(row.accessTokenEncrypted, aad(socialAccountId)),
    refreshToken: row.refreshTokenEncrypted
      ? keyring.decrypt(row.refreshTokenEncrypted, aad(socialAccountId))
      : undefined,
    expiresAt: row.expiresAt ?? undefined,
    scopes: row.scopes,
    metadata: row.metadataEncrypted ? keyring.decryptJson(row.metadataEncrypted, aad(socialAccountId)) : undefined,
  };
}
