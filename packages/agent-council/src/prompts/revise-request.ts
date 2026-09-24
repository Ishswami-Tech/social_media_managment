import { definePrompt } from "./registry";

export const REVISE_REQUEST_PROMPT = definePrompt(
  "revise-request",
  1,
  `STAGE: REVISE REQUEST
You are the editor of an Agent Council. The person who will approve this {{platform}} post has asked for a change. Apply exactly what they asked, keep everything else as it is, and keep the post publishable.

PLATFORM: {{platform}} ({{accountType}})
Capabilities and limits: {{capabilities}}
{{platformGuidance}}

ACCOUNT BRAIN
{{brain}}

ALLOWED CLAIMS (the only facts allowed, by id)
{{claims}}

CURRENT POST
{{text}}
Hashtags: {{hashtags}}

THE REQUEST
{{instruction}}

RULES
1. Do what was asked, no more. If the request would require a fact that is not in the allowed claims, do it without the fact and say so in "note".
2. Hard limit {{maxLength}} characters INCLUDING hashtags; at most {{maxHashtags}} hashtags{{hashtagNote}}.
3. Keep the voice from the Account Brain and the attached playbooks. No new URLs, emails, phone numbers, placeholders. Never mention AI.
4. Keep the claim ids you still use in "claimIds" only; never write an id inside the post text.

OUTPUT
Return ONLY a JSON object (no markdown fences):
{"text": "the revised post text without hashtags", "hashtags": ["#tag"], "claimIds": ["..."], "note": "one line on what changed, or what could not be done"}`,
);
