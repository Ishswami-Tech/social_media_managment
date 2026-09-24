"use client";

/**
 * "Expected reach" for a finished post: a band, a score and the reasons behind
 * it, so a person can decide whether to edit before approving. The wording is
 * deliberately an estimate, never a promise.
 */
import { useState } from "react";
import { ChevronDown, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PerformanceBadgeProps {
  score: number;
  band: "low" | "fair" | "good" | "strong";
  strengths: string[];
  improvements: string[];
  informedByHistory: boolean;
}

const BAND_LABEL: Record<PerformanceBadgeProps["band"], string> = {
  low: "Low",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
};

const BAND_CLASS: Record<PerformanceBadgeProps["band"], string> = {
  low: "border-destructive/40 text-destructive",
  fair: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  good: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  strong: "border-emerald-600/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function PerformanceBadge({ score, band, strengths, improvements, informedByHistory }: PerformanceBadgeProps) {
  const [open, setOpen] = useState(false);
  const detail = strengths.length + improvements.length > 0;
  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!detail}
        aria-expanded={open}
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs disabled:cursor-default",
          BAND_CLASS[band],
        )}
        title={informedByHistory ? "Estimate from platform conventions and this account's own history" : "Estimate from platform conventions; this account has no learned history yet"}
      >
        <Gauge className="size-3.5" aria-hidden />
        <span>
          Expected reach: {BAND_LABEL[band]} · {score}
        </span>
        {detail && <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />}
      </button>
      {open && (
        <div className="grid gap-1 rounded-md bg-muted/40 p-2 text-xs">
          {strengths.map((s) => (
            <p key={s} className="text-emerald-700 dark:text-emerald-400">
              + {s}
            </p>
          ))}
          {improvements.map((s) => (
            <p key={s} className="text-muted-foreground">
              − {s}
            </p>
          ))}
          <p className="pt-1 text-[11px] text-muted-foreground">
            {informedByHistory
              ? "Based on platform conventions, the blind judge and what has worked on this account."
              : "Based on platform conventions and the blind judge; it will learn from this account's results over time."}
          </p>
        </div>
      )}
    </div>
  );
}
