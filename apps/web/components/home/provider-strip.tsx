import { AlertTriangle, CheckCircle2, PauseCircle } from "lucide-react";
import { providerName, shortReason } from "@platform/agent-council/progress";
import { cn } from "@/lib/utils";

export interface ProviderStatus {
  provider: string;
  /** "ok" when calls go through, "cooling" while the circuit breaker is open, "failing" after recent errors. */
  state: "ok" | "cooling" | "failing";
  /** Plain reason for anything not ok, e.g. "no credits remaining", "high demand". */
  reason?: string;
  avgLatencyMs?: number;
}

const ICON = { ok: CheckCircle2, cooling: PauseCircle, failing: AlertTriangle } as const;
const TONE = {
  ok: "text-success",
  cooling: "text-warn",
  failing: "text-danger",
} as const;

/** One row per configured AI provider, so "why did everything land on one model" answers itself. */
export function ProviderStrip({ providers }: { providers: ProviderStatus[] }) {
  if (providers.length === 0) return <p className="text-[13px] text-muted-foreground">No AI provider is set up yet.</p>;
  return (
    <ul className="grid gap-2" aria-label="AI providers">
      {providers.map((p) => {
        const Icon = ICON[p.state];
        return (
          <li
            key={p.provider}
            className="flex items-center gap-2.5 text-[13px]"
            title={p.reason ?? (p.avgLatencyMs ? `avg ${(p.avgLatencyMs / 1000).toFixed(1)} s` : "healthy")}
          >
            <Icon className={cn("size-4 shrink-0", TONE[p.state])} aria-hidden />
            <span className="font-medium">{providerName(p.provider)}</span>
            <span className={cn("ml-auto truncate font-mono text-[12px]", p.state === "ok" ? "text-muted-foreground" : TONE[p.state])}>
              {p.state === "ok"
                ? p.avgLatencyMs
                  ? `${(p.avgLatencyMs / 1000).toFixed(1)} s avg`
                  : "ready"
                : p.state === "cooling"
                  ? `cooling · ${p.reason ? shortReason(p.reason) : "recent errors"}`
                  : shortReason(p.reason)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
