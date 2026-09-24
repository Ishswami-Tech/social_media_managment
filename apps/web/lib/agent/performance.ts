/**
 * Expected-performance estimate for a recommendation, computed server-side
 * from the final text, the account's learned profile and the blind judge's
 * score of the winning draft. Pure over its input so pages can call it inline.
 */
import type { Prisma } from "@platform/database";
import { estimatePerformance, type PerformanceEstimate } from "@platform/agent-council/scoring";
import { profileToBrain } from "@/lib/agent/store";

export interface PerformanceView {
  score: number;
  band: PerformanceEstimate["band"];
  strengths: string[];
  improvements: string[];
  /** True when the account has learned history behind the estimate. */
  informedByHistory: boolean;
}

export interface EstimateSource {
  platform: string;
  finalText: string | null;
  editedText: string | null;
  finalHashtags: string[];
  strategy: Prisma.JsonValue | null;
  winnerDraftId: string | null;
  drafts: { id: string; judgeScore: number | null }[];
  socialAccount: {
    profile: Parameters<typeof profileToBrain>[0];
  };
}

function strategyOf(value: Prisma.JsonValue | null): { hookType?: string; cta?: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.hookType === "string" ? { hookType: record.hookType } : {}),
    ...(typeof record.cta === "string" ? { cta: record.cta } : {}),
  };
}

/** Null while the text is still being written. */
export function performanceFor(account: EstimateSource): PerformanceView | null {
  const text = account.editedText ?? account.finalText;
  if (!text) return null;
  const winner = account.winnerDraftId ? account.drafts.find((d) => d.id === account.winnerDraftId) : undefined;
  const estimate = estimatePerformance({
    text,
    hashtags: account.finalHashtags,
    platform: account.platform,
    brain: profileToBrain(account.socialAccount.profile),
    judgeScore: winner?.judgeScore ?? null,
    strategy: strategyOf(account.strategy),
  });
  return {
    score: estimate.score,
    band: estimate.band,
    strengths: estimate.strengths,
    improvements: estimate.improvements,
    informedByHistory: estimate.historyWeight > 0,
  };
}
