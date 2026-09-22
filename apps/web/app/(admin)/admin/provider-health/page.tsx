import { providerHealthSummary } from "@/lib/agent/provider-health";
import { formatDate } from "@/lib/utils";
import { formatLatency } from "@/components/agent/format";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Provider health" };
export const dynamic = "force-dynamic";

/** CLOSED is healthy; OPEN refuses calls; HALF_OPEN is letting a probe through. */
const STATE_VARIANTS: Record<string, "success" | "destructive" | "warning" | "outline"> = {
  CLOSED: "success",
  OPEN: "destructive",
  HALF_OPEN: "warning",
};

export default async function AdminProviderHealthPage() {
  const providers = await providerHealthSummary();

  return (
    <>
      <PageHeader
        title="Provider health"
        description="Shared circuit breaker per AI provider: 5 failures in 60 s opens it for 120 s, then one probe decides."
      />
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Failures</TableHead>
                <TableHead>Successes</TableHead>
                <TableHead>Avg latency</TableHead>
                <TableHead>Opened until</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No provider calls recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {providers.map((p) => (
                <TableRow key={p.provider}>
                  <TableCell className="font-medium">{p.provider}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Badge variant={STATE_VARIANTS[p.state] ?? "outline"}>
                        {p.state.replaceAll("_", " ").toLowerCase()}
                      </Badge>
                      {p.open && <span className="text-xs text-destructive">refusing calls</span>}
                    </span>
                  </TableCell>
                  <TableCell>
                    {p.failureCount}
                    {p.lastFailureAt && (
                      <span className="block text-xs text-muted-foreground">last {formatDate(p.lastFailureAt)}</span>
                    )}
                  </TableCell>
                  <TableCell>{p.successCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatLatency(p.avgLatencyMs)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.openedUntil ? formatDate(p.openedUntil) : "—"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{p.lastError ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
