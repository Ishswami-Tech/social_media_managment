import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Social integrations" };

export default async function AdminSocial() {
  const env = getEnv();
  const [byStatus, failing] = await Promise.all([
    prisma.socialAccount.groupBy({ by: ["platform", "status"], _count: { _all: true } }),
    prisma.socialAccount.findMany({
      where: { status: { in: ["EXPIRED", "ERROR"] } },
      include: { organization: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);
  const integrations = [
    {
      name: "LinkedIn",
      configured: !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
      callback: `${env.APP_URL}/api/oauth/linkedin/callback`,
    },
    {
      name: "Meta (Facebook, Instagram, WhatsApp)",
      configured: !!(env.META_APP_ID && env.META_APP_SECRET),
      callback: `${env.APP_URL}/api/oauth/meta/callback`,
      webhook: `${env.WEBHOOK_BASE_URL ?? env.APP_URL}/api/webhooks/meta`,
      verify: !!env.META_WEBHOOK_VERIFY_TOKEN,
    },
    { name: "X", configured: false },
    { name: "TikTok", configured: false },
    { name: "YouTube / Google", configured: false },
  ];
  return (
    <>
      <PageHeader
        title="Social integrations"
        description="OAuth app configuration status and accounts needing attention."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider apps</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {integrations.map((i) => (
              <div key={i.name} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{i.name}</span>
                  <Badge variant={i.configured ? "success" : "outline"}>
                    {i.configured ? "configured" : "not configured"}
                  </Badge>
                </div>
                {i.callback && <p className="mt-1 text-xs text-muted-foreground">Callback: {i.callback}</p>}
                {i.webhook && (
                  <p className="text-xs text-muted-foreground">
                    Webhook: {i.webhook} {i.verify ? "(verify token set)" : "(verify token missing)"}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Accounts by status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {byStatus.map((r) => (
              <div key={`${r.platform}${r.status}`} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <PlatformIcon platform={r.platform} /> {r.platform}
                </span>
                <span className="flex items-center gap-2">
                  {r._count._all} <StatusBadge status={r.status} />
                </span>
              </div>
            ))}
            {byStatus.length === 0 && <p className="text-muted-foreground">No accounts yet.</p>}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Accounts needing reconnection</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failing.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="flex items-center gap-2">
                    <PlatformIcon platform={a.platform} /> {a.displayName}
                  </TableCell>
                  <TableCell>{a.organization.name}</TableCell>
                  <TableCell>
                    <StatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="max-w-md truncate text-xs text-muted-foreground">{a.lastError}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(a.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {failing.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    All accounts healthy.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
