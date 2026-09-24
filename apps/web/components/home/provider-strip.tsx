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
  ok: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  cooling: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  failing: "border-destructive/50 text-destructive",
} as const;

/** One chip per configured AI provider, so "why did everything land on one model" answers itself. */
export function ProviderStrip({ providers }: { providers: ProviderStatus[] }) {
  if (providers.length === 0) return null;
  return (
    <ul className="mb-5 flex flex-wrap gap-2" aria-label="AI providers">
      {providers.map((p) => {
        const Icon = ICON[p.state];
        return (
          <li
            key={p.provider}
            className={cn("inline-flex items-center gap-1.5 rounded-full border bg-white/50 px-2.5 py-1 text-xs backdrop-blur-xl dark:bg-white/[0.04]", TONE[p.state])}
            title={p.reason ?? (p.avgLatencyMs ? `avg ${(p.avgLatencyMs / 1000).toFixed(1)} s` : "healthy")}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="font-medium">{providerName(p.provider)}</span>
            <span className="text-muted-foreground">
              {p.state === "ok" ? "ready" : p.state === "cooling" ? `cooling down · ${p.reason ? shortReason(p.reason) : "recent errors"}` : shortReason(p.reason)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
