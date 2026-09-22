import type { CheckIssue } from "../contracts";
import { issue, type CheckInput } from "./types";
import { effectiveLength } from "./length";

export const X_HARD_LIMIT = 280;

/** Platform-specific rules beyond the generic capability limits. */
export const platformRulesCheck = (input: CheckInput): CheckIssue[] => [...mediaRule(input), ...xRule(input)];

function mediaRule(input: CheckInput): CheckIssue[] {
  if (!input.capabilities.media.required || input.hasMedia) return [];
  return [issue("media_required", `${input.platform} requires media; no media or media concept provided`)];
}

function xRule(input: CheckInput): CheckIssue[] {
  if (input.platform !== "X") return [];
  const limit = Math.min(X_HARD_LIMIT, input.capabilities.text.maxLength);
  const length = effectiveLength(input.text, input.hashtags);
  return length > limit ? [issue("x_length", `X posts must be at most ${limit} characters (got ${length})`)] : [];
}
