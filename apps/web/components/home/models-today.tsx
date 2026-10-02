import type { ModelUse } from "@/lib/home/overview";

/** One row per model that wrote drafts in the last day, so a single-model day is visible at once. */
export function ModelsToday({ models }: { models: ModelUse[] }) {
  if (models.length === 0) return <p className="text-[13px] text-muted-foreground">No drafts written in the last day.</p>;
  const providers = new Set(models.map((m) => m.provider)).size;
  const max = Math.max(...models.map((m) => m.drafts));
  return (
    <div className="grid gap-2" aria-label="Models that wrote today">
      {models.map((m) => (
        <div key={`${m.provider}:${m.model}`} className="grid gap-1" title={`${m.providerLabel} · ${m.model}`}>
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="truncate font-medium">{m.label}</span>
            <span className="font-mono text-[12px] text-muted-foreground tabular">
              {m.drafts} {m.drafts === 1 ? "draft" : "drafts"}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-agent-quill" style={{ width: `${(m.drafts / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {providers === 1 && <p className="text-[12px] text-warn">Every draft came from one provider today.</p>}
    </div>
  );
}
