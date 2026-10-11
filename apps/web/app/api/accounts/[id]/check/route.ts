import { loadSocialCredential } from "@platform/database";
import { isDisconnectError, needsRefresh } from "@platform/social-core";
import { json, withOrg, notFound, conflict } from "@/lib/api";
import { keyring, prisma } from "@/lib/db";
import { providers } from "@/lib/providers";
import { audit } from "@/lib/audit";

/** Verify remote access without publishing or returning credentials to the browser. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "accounts:connect", async (ctx) => {
    const { id } = await params;
    const account = await prisma.socialAccount.findFirst({ where: { id, organizationId: ctx.organization.id } });
    if (!account) throw notFound("Account");
    if (account.status === "DISCONNECTED") throw conflict("Reconnect this account to check its connection");
    const credential = await loadSocialCredential(prisma, keyring(), account.id);
    if (!credential) throw conflict("Reconnect this account: its saved authorization is missing");
    if (needsRefresh(credential.expiresAt))
      throw conflict("Reconnect this account or allow the publisher to refresh its authorization before checking");
    try {
      await providers()
        .get(account.platform)
        .getAccount({
          credential,
          externalAccountId: account.externalAccountId,
          accountType: account.accountType,
          metadata: (account.metadata as Record<string, unknown>) ?? undefined,
        });
      const updated = await prisma.socialAccount.updateMany({
        where: { id, organizationId: ctx.organization.id, status: account.status },
        data: { status: "CONNECTED", lastError: null },
      });
      if (!updated.count) throw conflict("This account changed during the check. Refresh and try again.");
      await audit(ctx, "account.check", "SocialAccount", id, { ok: true });
      return json({
        ok: true,
        message: "Connection verified. Publishing still requires the provider's publishing permissions.",
      });
    } catch (error) {
      if (isDisconnectError(error)) {
        await prisma.socialAccount.updateMany({
          where: { id, organizationId: ctx.organization.id, status: account.status },
          data: { status: "EXPIRED", lastError: "Authorization is no longer valid. Reconnect this account." },
        });
        await audit(ctx, "account.check", "SocialAccount", id, { ok: false });
      }
      throw error;
    }
  });
