import { Cpu } from "lucide-react";
import type { ModelUse } from "@/lib/home/overview";

/** One chip per model that wrote drafts in the last day, so a single-model day is visible at once. */
export function ModelsToday({ models }: { models: ModelUse[] }) {
  if (models.length === 0) return null;
  const providers = new Set(models.map((m) => m.provider)).size;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 text-xs" aria-label="Models that wrote today">
      <span className="flex items-center gap-1 text-muted-foreground">
        <Cpu className="size-3.5" aria-hidden /> Wrote today
        {providers === 1 && models.length > 0 ? " · one provider only" : ""}
      </span>
      {models.map((m) => (
        <span
          key={`${m.provider}:${m.model}`}
          className="inline-flex items-center gap-1 rounded-full border bg-white/50 px-2.5 py-1 backdrop-blur-xl dark:bg-white/[0.04]"
          title={`${m.providerLabel} · ${m.model}`}
        >
          <span className="font-medium">{m.label}</span>
          <span className="text-muted-foreground">×{m.drafts}</span>
        </span>
      ))}
    </div>
  );
}
