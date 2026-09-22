import type { CheckIssue, CheckResult } from "../contracts";
import { bannedPhrasesCheck, forbiddenTopicsCheck } from "./banned";
import { claimsCheck } from "./claims";
import { duplicatesCheck } from "./duplicates";
import { hashtagsCheck } from "./hashtags";
import { lengthCheck } from "./length";
import { piiCheck } from "./pii";
import { platformRulesCheck } from "./platform";
import type { Check, CheckInput } from "./types";
import { urlsCheck } from "./urls";

export const ALL_CHECKS: readonly Check[] = [
  lengthCheck,
  urlsCheck,
  piiCheck,
  bannedPhrasesCheck,
  forbiddenTopicsCheck,
  hashtagsCheck,
  duplicatesCheck,
  claimsCheck,
  platformRulesCheck,
];

/** Runs every deterministic check; `ok` is false when any issue has severity "error". */
export function runChecks(input: CheckInput, checks: readonly Check[] = ALL_CHECKS): CheckResult {
  const issues: CheckIssue[] = checks.flatMap((check) => check(input));
  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

export function checkErrors(result: CheckResult): CheckIssue[] {
  return result.issues.filter((i) => i.severity === "error");
}

export { effectiveLength } from "./length";
export { extractUrls, allowedUrls } from "./urls";
export { extractEmails, extractPhones } from "./pii";
export { bannedPhrasesCheck, forbiddenTopicsCheck } from "./banned";
export { hashtagsCheck, hashtagLimit, allHashtags, HASHTAG_LIMITS, DEFAULT_HASHTAG_LIMIT } from "./hashtags";
export { duplicatesCheck, maxSimilarity, DUPLICATE_THRESHOLD } from "./duplicates";
export { claimsCheck, factualSentences, claimCovers } from "./claims";
export { platformRulesCheck, X_HARD_LIMIT } from "./platform";
export { lengthCheck } from "./length";
export { urlsCheck } from "./urls";
export { piiCheck } from "./pii";
export { jaccard, tokenize, significantTokens, sentences, briefText } from "./text-utils";
export type { Check, CheckInput } from "./types";
