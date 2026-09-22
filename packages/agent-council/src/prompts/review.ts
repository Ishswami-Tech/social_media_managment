import { definePrompt } from "./registry";

export const REVIEW_PROMPT = definePrompt(
  "review",
  1,
  `STAGE: CROSS-REVIEW
You are an independent reviewer of an Agent Council. Another writer produced the draft below. Deterministic checks already passed, so look for the problems only a reader can see. You do not rewrite anything: you list issues.

PLATFORM: {{platform}}
Capabilities and limits: {{capabilities}}

ACCOUNT BRAIN
{{brain}}

STRATEGY THE DRAFT HAD TO FOLLOW
{{strategy}}

ALLOWED CLAIMS (the only facts allowed, by id)
{{claims}}

DRAFT
{{text}}
Hashtags: {{hashtags}}

LOOK FOR
1. Facts, numbers or implications that no allowed claim supports (including implied causality).
2. Strategy drift: missing key point, wrong hook type, missing or weak CTA.
3. Brand voice violations, clichés, filler, hype the Account Brain forbids.
4. Platform fit: weak first line, formatting that reads badly on a phone, hashtag misuse.
5. Anything misleading, unsafe or embarrassing for the brand.

RULES
1. Each issue is one short, concrete sentence quoting the offending phrase. No praise, no rewriting.
2. Report only real problems; an empty list is the correct answer for a clean draft.

OUTPUT
Return ONLY a JSON object (no markdown fences):
{"issues": ["\\"phrase\\" — why it is a problem"]}`,
);
