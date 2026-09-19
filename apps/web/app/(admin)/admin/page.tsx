import { platformSummary } from "@/lib/services/analytics";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { PlatformIcon } from "@/components/app/platform-icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Admin overview" };

export default async function AdminOverview() {
  const s = await platformSummary();
  return (
    <>
      <PageHeader title="Platform overview" description="Health, usage and integration status across all tenants." />
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title="Active organizations"
          value={s.organizations.ACTIVE ?? 0}
          hint={`${s.organizations.SUSPENDED ?? 0} suspended`}
        />
        <StatCard title="Users" value={s.users} />
        <StatCard title="Posts" value={s.posts} hint={`${s.published30d} published in 30d`} />
        <StatCard title="Failed publish jobs (30d)" value={s.failedJobs30d} />
        <StatCard title="Failed webhooks" value={s.webhooksFailed} />
        <StatCard title="AI spend (30d)" value={`$${s.ai.cost.toFixed(2)}`} hint={`${s.ai.calls} calls`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Connected accounts by platform</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {s.accounts.map((a) => (
              <div key={a.platform} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <PlatformIcon platform={a.platform} /> {a.platform}
                </span>
                <span className="tabular-nums">{a.count}</span>
              </div>
            ))}
            {s.accounts.length === 0 && <p className="text-muted-foreground">None yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>AI usage by provider (30d)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {s.ai.byProvider.map((p) => (
              <div key={p.provider} className="flex items-center justify-between">
                <span>
                  {p.provider}{" "}
                  <span className="text-xs text-muted-foreground">
                    {p.calls} calls · {(p.inputTokens + p.outputTokens).toLocaleString()} tokens
                  </span>
                </span>
                <span className="tabular-nums">${p.cost.toFixed(2)}</span>
              </div>
            ))}
            {s.ai.byProvider.length === 0 && <p className="text-muted-foreground">No usage yet.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
