"use client";

import { useState } from "react";
import { CheckCircle2, CircleDashed, MinusCircle, XCircle } from "lucide-react";
import { formatCents, formatLatency } from "@/components/agent/format";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** One payload blob attached to an event, already serialized by the server. */
export interface ReplayPayload {
  label: string;
  json: string;
}

export interface ReplayEvent {
  id: string;
  step: string;
  status: string;
  provider: string | null;
  model: string | null;
  promptKey: string | null;
  promptVersion: number | null;
  costCents: number;
  latencyMs: number;
  error: string | null;
  createdAt: string;
  payloads: ReplayPayload[];
}

function StatusIcon({ status }: { status: string }) {
  if (status === "SUCCEEDED") return <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />;
  if (status === "FAILED") return <XCircle className="size-4 text-destructive" aria-hidden />;
  if (status === "SKIPPED") return <MinusCircle className="size-4 text-muted-foreground" aria-hidden />;
  return <CircleDashed className="size-4 text-amber-500" aria-hidden />;
}

const COLLAPSED_COUNT = 12;

export function RunReplay({ events }: { events: ReplayEvent[] }) {
  const [showAll, setShowAll] = useState(false);
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No steps recorded yet. The worker writes one event per stage.</p>;
  }
  const hidden = Math.max(0, events.length - COLLAPSED_COUNT);
  const visible = showAll || hidden === 0 ? events : events.slice(events.length - COLLAPSED_COUNT);

  return (
    <div className="grid gap-2">
      {hidden > 0 && (
        <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show recent steps only" : `Show ${hidden} earlier step(s)`}
        </Button>
      )}
      <ol className="grid gap-2">
        {visible.map((e) => (
          <li key={e.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusIcon status={e.status} />
              <span className="font-medium">{e.step}</span>
              <span className="text-xs text-muted-foreground">{formatDate(e.createdAt)}</span>
              {e.provider && (
                <span className="text-xs text-muted-foreground">
                  · {e.provider}
                  {e.model ? ` / ${e.model}` : ""}
                </span>
              )}
              {e.promptKey && (
                <span className="text-xs text-muted-foreground">
                  · {e.promptKey}
                  {e.promptVersion !== null ? `@v${e.promptVersion}` : ""}
                </span>
              )}
              {e.costCents > 0 && <span className="text-xs text-muted-foreground">· {formatCents(e.costCents)}</span>}
              {e.latencyMs > 0 && <span className="text-xs text-muted-foreground">· {formatLatency(e.latencyMs)}</span>}
            </div>
            {e.error && <p className="mt-1 text-xs text-destructive">{e.error}</p>}
            {e.payloads.length > 0 && (
              <div className="mt-2 grid gap-1">
                {e.payloads.map((p) => (
                  <details key={p.label} className="rounded-md bg-muted/50 px-2 py-1">
                    <summary className="cursor-pointer text-xs font-medium">{p.label}</summary>
                    <pre className="mt-1 max-h-72 overflow-auto text-[11px] whitespace-pre-wrap break-words">
                      {p.json}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
