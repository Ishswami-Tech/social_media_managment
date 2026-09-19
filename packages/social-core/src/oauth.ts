import { createHash, randomBytes } from "node:crypto";

export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

/** PKCE (RFC 7636) helpers, used by providers that support it (X, TikTok, Google). */
export function generateCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildUrl(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

export function expiresAtFromSeconds(seconds: number | undefined | null, now = Date.now()): Date | undefined {
  if (!seconds || seconds <= 0) return undefined;
  return new Date(now + seconds * 1000);
}

/** True when a credential should be refreshed (expired or within the skew window). */
export function needsRefresh(expiresAt: Date | null | undefined, skewMs = 5 * 60_000, now = Date.now()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - skewMs <= now;
}
