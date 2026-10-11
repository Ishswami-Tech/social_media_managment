import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isFamilyConfigured, PLATFORM_LABELS } from "@/lib/providers";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { AccountActions, AgentAutoPublishSwitch } from "@/components/forms/account-actions";
import { ConnectionSetup } from "@/components/forms/connection-setup";
import { callbackUrl } from "@/lib/services/oauth";
import { getEnv } from "@/lib/env";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Connected accounts" };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const ctx = await requireCapability("accounts:view");
  const { connected, error } = await searchParams;
  const accounts = await prisma.socialAccount.findMany({
    where: { organizationId: ctx.organization.id },
    orderBy: [{ platform: "asc" }, { displayName: "asc" }],
  });
  const canConnect = ctx.can("accounts:connect");
  return (
    <>
      <PageHeader
        title="Connected accounts"
        description="Connect your social channels, check connection status, and choose how posts are approved."
      />
      {canConnect && (
        <ConnectionSetup
          families={[
            {
              name: "Facebook / Instagram",
              family: "meta",
              configured: isFamilyConfigured("META"),
              callback: callbackUrl("META"),
              description: "Publish to Facebook Pages and linked Instagram professional accounts.",
              dashboard: getEnv().META_APP_ID
                ? `https://developers.facebook.com/apps/${getEnv().META_APP_ID}/fb-login/settings/`
                : "https://developers.facebook.com/apps/",
              connected: accounts.filter(
                (a) => ["FACEBOOK", "INSTAGRAM"].includes(a.platform) && a.status === "CONNECTED",
              ).length,
              attention: accounts.filter(
                (a) => ["FACEBOOK", "INSTAGRAM"].includes(a.platform) && a.status === "EXPIRED",
              ).length,
            },
            {
              name: "LinkedIn",
              family: "linkedin",
              configured: isFamilyConfigured("LINKEDIN"),
              callback: callbackUrl("LINKEDIN"),
              description: "Publish posts and media to your LinkedIn profile.",
              dashboard: "https://www.linkedin.com/developers/apps",
              connected: accounts.filter((a) => a.platform === "LINKEDIN" && a.status === "CONNECTED").length,
              attention: accounts.filter((a) => a.platform === "LINKEDIN" && a.status === "EXPIRED").length,
            },
          ]}
        />
      )}
      {connected && (
        <Alert className="mb-4">
          <AlertTitle>Connected {connected} account(s)</AlertTitle>
          <AlertDescription>
            Tokens were encrypted and stored. You can now select these accounts when creating posts.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Connection failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Auto-publish by campaigns</TableHead>
                <TableHead>Connected</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No accounts connected yet.
                  </TableCell>
                </TableRow>
              )}
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <PlatformIcon platform={a.platform} />
                      <span>
                        <span className="block font-medium">{a.displayName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {PLATFORM_LABELS[a.platform]}
                          {a.username ? ` · @${a.username}` : ""}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="capitalize">{a.accountType.toLowerCase()}</TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                    {a.lastError && (
                      <span className="block max-w-60 truncate text-xs text-destructive">{a.lastError}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.requireApproval === null
                      ? `Org default (${ctx.settings.requireApproval ? "required" : "off"})`
                      : a.requireApproval
                        ? "Required"
                        : "Off"}
                  </TableCell>
                  <TableCell>
                    {canConnect ? (
                      <AgentAutoPublishSwitch id={a.id} enabled={a.agentAutoPublish} />
                    ) : (
                      <span className="text-sm text-muted-foreground">{a.agentAutoPublish ? "On" : "Off"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(a.createdAt, { dateStyle: "medium" })}
                  </TableCell>
                  <TableCell className="text-right">
                    {canConnect && (
                      <AccountActions
                        id={a.id}
                        platform={a.platform}
                        requireApproval={a.requireApproval}
                        status={a.status}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
