export * from "./registry";
export { RESEARCH_PROMPT } from "./research";
export { CLAIMS_PROMPT } from "./claims";
export { STRATEGY_PROMPT } from "./strategy";
export { WRITER_PROMPT } from "./writer";
export { REVISION_PROMPT } from "./revision";
export { REVIEW_PROMPT } from "./review";
export { JUDGE_PROMPT } from "./judge";
export { SYNTHESIS_PROMPT } from "./synthesis";
export { ADAPT_PROMPT } from "./adapt";
export { SKILLS_PROMPT } from "./skills";
export { REVISE_REQUEST_PROMPT } from "./revise-request";

export const PROMPT_KEYS = [
  "research",
  "claims",
  "skills",
  "strategy",
  "writer",
  "revision",
  "review",
  "judge",
  "synthesis",
  "adapt",
  "revise-request",
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];
