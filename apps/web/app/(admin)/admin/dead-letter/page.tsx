import { listDeadLetters, type DeadLetterEntry } from "@platform/queue";
import { queues } from "@/lib/queue";
import { formatDate, truncate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { DeadLetterRetry } from "@/components/forms/dead-letter-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Dead letters" };
export const dynamic = "force-dynamic";

export default async function AdminDeadLetterPage() {
  let entries: DeadLetterEntry[] = [];
  let queueError: string | null = null;
  try {
    entries = await listDeadLetters(queues());
  } catch (e) {
    queueError = e instanceof Error ? e.message : "Queue unavailable";
  }

  return (
    <>
      <PageHeader
        title="Dead letters"
        description="Jobs that exhausted their retries. Inspect the payload, fix the cause, then re-enqueue."
      />
      {queueError && <p className="mb-4 text-sm text-destructive">Redis unavailable: {queueError}</p>}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead>Original job</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Parked</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {queueError ? "Could not read the dead-letter queue." : "Nothing parked — every job succeeded."}
                  </TableCell>
                </TableRow>
              )}
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.data.queue}</TableCell>
                  <TableCell className="max-w-56 truncate text-xs">{entry.data.originalJobId}</TableCell>
                  <TableCell>{entry.data.attempts}</TableCell>
                  <TableCell className="max-w-sm">
                    <span className="block truncate text-xs text-muted-foreground">
                      {truncate(entry.data.error, 120)}
                    </span>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs">Payload</summary>
                      <pre className="mt-1 max-h-64 overflow-auto text-[11px] whitespace-pre-wrap break-words">
                        {JSON.stringify(entry.data.data, null, 2)}
                      </pre>
                    </details>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(new Date(entry.parkedAt))}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeadLetterRetry id={entry.id} />
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
