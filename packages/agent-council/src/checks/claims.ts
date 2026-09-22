import type { ClaimRecord } from "../contracts";
import { issue, type CheckInput } from "./types";
import { sentences, significantTokens } from "./text-utils";

const FACTUAL_PATTERN =
  /\d[\d,.]*\s*(?:%|percent|x\b|×|million|billion|trillion|bn\b|k\b|m\b)|[$€£]\s?\d|\d\s*(?:million|billion)|\b(?:stud(?:y|ies)|report(?:s|ed)?|research shows|survey|according to|data shows)\b/iu;

export const MIN_SHARED_TOKENS = 2;

/** URLs and hashtags are not assertions; they would otherwise trigger the heuristic. */
function assertionOnly(sentence: string): string {
  return sentence.replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/giu, " ").replace(/#[\p{L}\p{N}_]+/gu, " ");
}

/** Sentences that assert a number, price, multiplier or cite a study/report. */
export function factualSentences(text: string): string[] {
  return sentences(text).filter((s) => FACTUAL_PATTERN.test(assertionOnly(s)));
}

export function claimCovers(sentence: string, claim: ClaimRecord): boolean {
  const claimTokens = significantTokens(claim.statement);
  const shared = [...significantTokens(sentence)].filter((t) => claimTokens.has(t));
  return shared.length >= MIN_SHARED_TOKENS;
}

/** Every factual sentence must be backed by a SUPPORTED claim sharing ≥ 2 significant tokens. */
export const claimsCheck = (input: CheckInput) => {
  const supported = input.claims.filter((c) => c.status === "SUPPORTED");
  return factualSentences(input.text)
    .filter((sentence) => !supported.some((claim) => claimCovers(sentence, claim)))
    .map((sentence) => issue("unsupported_claim", `No SUPPORTED claim backs: "${sentence.slice(0, 120)}"`));
};
