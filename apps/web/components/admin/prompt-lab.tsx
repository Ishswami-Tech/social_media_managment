"use client";

/**
 * Prompt lab: pick a stage prompt and a real campaign account, choose up to
 * four models, run, and compare the answers with the pipeline's checks and
 * the reach estimate. Nothing here touches the campaign itself.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Play } from "lucide-react";
import type { LabModelResult, LabResult, LabRunOption } from "@/lib/agent/lab";
import { cn } from "@/lib/utils";
import { PlatformIcon } from "@/components/app/platform-icon";
import { PerformanceBadge } from "@/components/agent/performance-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface PromptOption {
  key: string;
  version: number;
  hash: string;
  template: string;
}

interface ModelOption {
  id: string;
  label: string;
  source: string;
}

const PROMPT_LABELS: Record<string, string> = {
  writer: "Writer (Quill)",
  review: "Platform reviewer (Lens)",
  adapt: "Editor (Polish)",
  "revise-request": "Revise with AI",
  strategy: "Strategist (Compass)",
};

const MAX_MODELS = 4;

export function PromptLab({ prompts, runs }: { prompts: PromptOption[]; runs: LabRunOption[] }) {
  const [promptKey, setPromptKey] = useState(prompts[0]?.key ?? "writer");
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const run = runs.find((r) => r.id === runId);
  const [accountId, setAccountId] = useState(run?.accounts[0]?.id ?? "");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [lane, setLane] = useState<"A" | "B" | "C">("A");
  const [instruction, setInstruction] = useState("Make it shorter and end with a question");
  const [temperature, setTemperature] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LabResult | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    fetch(`/api/admin/prompts/models?runId=${encodeURIComponent(runId)}`)
      .then((r) => r.json())
      .then((data: { models?: ModelOption[] }) => {
        if (stopped) return;
        const list = data.models ?? [];
        setModels(list);
        setSelected((cur) => (cur.length ? cur.filter((id) => list.some((m) => m.id === id)) : list.slice(0, 2).map((m) => m.id)));
      })
      .catch(() => setModels([]));
    return () => {
      stopped = true;
    };
  }, [runId]);

  function pickRun(id: string) {
    setRunId(id);
    const next = runs.find((r) => r.id === id);
    setAccountId(next?.accounts[0]?.id ?? "");
    setResult(null);
  }

  async function runLab() {
    if (!runId || !accountId || selected.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/prompts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptKey,
          runId,
          accountId,
          models: selected,
          temperature,
          ...(promptKey === "writer" ? { lane } : {}),
          ...(promptKey === "revise-request" ? { instruction } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: LabResult; message?: string };
      if (!res.ok || !data.result) throw new Error(data.message ?? "The lab run failed");
      setResult(data.result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The lab run failed");
    } finally {
      setBusy(false);
    }
  }

  const prompt = prompts.find((p) => p.key === promptKey);

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-2xl border border-white/60 bg-white/55 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Prompt</span>
            <select value={promptKey} onChange={(e) => (setPromptKey(e.target.value), setResult(null))} className="h-9 rounded-md border bg-background px-2 text-sm">
              {prompts.map((p) => (
                <option key={p.key} value={p.key}>
                  {PROMPT_LABELS[p.key] ?? p.key} · v{p.version}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Campaign (context)</span>
            <select value={runId} onChange={(e) => pickRun(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.topic.slice(0, 60)} · {r.organization} · {r.status.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Account</span>
            <select value={accountId} onChange={(e) => (setAccountId(e.target.value), setResult(null))} className="h-9 rounded-md border bg-background px-2 text-sm">
              {(run?.accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName} · {a.platform.toLowerCase()}
                  {a.hasText ? "" : " · no text yet"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-1 text-sm">
          <span className="font-medium">Models (up to {MAX_MODELS})</span>
          <div className="flex flex-wrap gap-2">
            {models.length === 0 && <span className="text-xs text-muted-foreground">No models reachable for this organization.</span>}
            {models.map((m) => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected((cur) => (on ? cur.filter((id) => id !== m.id) : cur.length >= MAX_MODELS ? cur : [...cur, m.id]))}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs", on ? "border-brand/40 bg-brand/10" : "text-muted-foreground")}
                  title={m.source}
                >
                  {on && <Check className="size-3" aria-hidden />} {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 text-sm">
          {promptKey === "writer" && (
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Lane</span>
              <select value={lane} onChange={(e) => setLane(e.target.value as "A" | "B" | "C")} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="A">A · Story</option>
                <option value="B">B · Evidence</option>
                <option value="C">C · Contrarian</option>
              </select>
            </label>
          )}
          {promptKey === "revise-request" && (
            <label className="grid flex-1 gap-1">
              <span className="text-xs text-muted-foreground">Instruction</span>
              <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={1000} />
            </label>
          )}
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Temperature {temperature.toFixed(1)}</span>
            <input type="range" min={0} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-36" />
          </label>
          <Button onClick={() => void runLab()} disabled={busy || !accountId || selected.length === 0}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />} Run on {selected.length} model{selected.length === 1 ? "" : "s"}
          </Button>
          <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? "Hide template" : "Show template"}
          </button>
        </div>
        {showPrompt && prompt && (
          <Textarea readOnly value={prompt.template} rows={14} className="font-mono text-xs" aria-label="Prompt template" />
        )}
      </section>

      {result && (
        <section className="grid gap-3">
          <details className="rounded-xl border border-white/60 bg-white/50 p-3 text-xs backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]">
            <summary className="cursor-pointer font-medium">
              Rendered prompt · {PROMPT_LABELS[result.promptKey] ?? result.promptKey} v{result.promptVersion} · {result.system.length.toLocaleString()} chars
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-mono">{result.system}</pre>
          </details>
          <div className={cn("grid gap-3", result.results.length >= 2 && "md:grid-cols-2")}>
            {result.results.map((r) => (
              <ResultCard key={`${r.provider}::${r.model}`} result={r} run={run} accountId={accountId} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ResultCard({ result, run, accountId }: { result: LabModelResult; run: LabRunOption | undefined; accountId: string }) {
  const account = run?.accounts.find((a) => a.id === accountId);
  return (
    <article className={cn("grid content-start gap-2 rounded-xl border bg-white/60 p-3 text-sm backdrop-blur-xl dark:bg-white/[0.04]", result.ok ? "border-white/60 dark:border-white/10" : "border-destructive/50")}>
      <header className="flex flex-wrap items-center gap-2">
        {account && <PlatformIcon platform={account.platform} className="size-4 text-[8px]" />}
        <span className="font-semibold">{result.model}</span>
        <span className="text-xs text-muted-foreground">{result.provider}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {(result.latencyMs / 1000).toFixed(1)} s · {result.inputTokens}→{result.outputTokens} tokens
        </span>
      </header>
      {!result.ok && <p className="text-xs text-destructive">{result.error}</p>}
      {result.estimate && <PerformanceBadge {...result.estimate} informedByHistory={false} />}
      {result.checks && (
        <p className={cn("text-xs", result.checks.ok ? "text-emerald-600" : "text-amber-600")}>
          Checks: {result.checks.ok ? "passed" : result.checks.issues.map((i) => i.message).join("; ")}
        </p>
      )}
      {result.text ? (
        <p className="whitespace-pre-wrap text-[13px] leading-snug">
          {result.text}
          {result.hashtags?.length ? `\n\n${result.hashtags.join(" ")}` : ""}
        </p>
      ) : result.value !== undefined ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[11px]">{JSON.stringify(result.value, null, 2)}</pre>
      ) : result.raw ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[11px]">{result.raw}</pre>
      ) : null}
    </article>
  );
}
