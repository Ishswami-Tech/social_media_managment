/**
 * Prompt lab: render a stage's prompt exactly as the pipeline would, from a
 * real run and account, so a prompt can be tried against several models side
 * by side and judged with the same checks the pipeline applies.
 */
import { z } from "zod";
import { runChecks } from "./checks";
import type { CheckResult, PipelineContext, RunSnapshot } from "./contracts";
import { renderPrompt } from "./prompts";
import { WRITER_LANES } from "./progress";
import { AdaptOutputSchema } from "./stages/adapt";
import { ReviseOutputSchema } from "./stages/editing";
import { ReviewNotesOutputSchema } from "./stages/review";
import { StrategyOutputSchema } from "./stages/strategy";
import {
  accountVars,
  checkInputFor,
  claimsText,
  DraftOutputSchema,
  plannedMedia,
  stringify,
  strategyText,
  supportedClaims,
  withSkills,
  type RunAccountSnapshot,
} from "./stages/shared";

export const LAB_PROMPT_KEYS = ["writer", "review", "adapt", "revise-request", "strategy"] as const;
export type LabPromptKey = (typeof LAB_PROMPT_KEYS)[number];

export interface LabOptions {
  /** Writer lane label (A, B, C); defaults to A. */
  lane?: string;
  /** Instruction for `revise-request`. */
  instruction?: string;
}

const BRIEF_CHARS = 8_000;

/** The system and user messages a stage would send for this account. */
export function renderLabPrompt(
  key: LabPromptKey,
  ctx: PipelineContext,
  run: RunSnapshot,
  account: RunAccountSnapshot,
  options: LabOptions = {},
): { system: string; user: string; json: boolean } {
  const claims = claimsText(supportedClaims(run.claims));
  const current = { text: account.recommendation?.finalText ?? account.drafts.at(-1)?.text ?? "", hashtags: account.recommendation?.hashtags ?? [] };
  switch (key) {
    case "writer": {
      const lane = WRITER_LANES[options.lane ?? "A"];
      return {
        system: withSkills(
          ctx,
          renderPrompt("writer", {
            ...accountVars(account),
            strategy: strategyText(account.strategy),
            claims,
            lane: lane ? `${lane.name}: ${lane.brief}` : "Your own best angle within the strategy.",
          }),
          run,
          account.platform,
        ),
        user: "Write the post now. Return only the JSON object.",
        json: true,
      };
    }
    case "review":
      return {
        system: withSkills(
          ctx,
          renderPrompt("review", { ...accountVars(account), strategy: strategyText(account.strategy), claims, text: current.text, hashtags: current.hashtags.join(" ") }),
          run,
          account.platform,
        ),
        user: `Review this draft as a ${account.platform} reader now. Return only the JSON object.`,
        json: true,
      };
    case "adapt":
      return {
        system: withSkills(
          ctx,
          renderPrompt("adapt", { ...accountVars(account), strategy: strategyText(account.strategy), claims, text: current.text, hashtags: current.hashtags.join(" ") }),
          run,
          account.platform,
        ),
        user: "Adapt the post to the platform now. Return only the JSON object.",
        json: true,
      };
    case "revise-request":
      return {
        system: withSkills(
          ctx,
          renderPrompt("revise-request", {
            ...accountVars(account),
            claims,
            text: current.text,
            hashtags: current.hashtags.join(" "),
            instruction: options.instruction?.trim() || "Make it shorter",
          }),
          run,
          account.platform,
        ),
        user: "Apply the request now. Return only the JSON object.",
        json: true,
      };
    case "strategy":
      return {
        system: renderPrompt("strategy", {
          ...accountVars(account),
          topic: run.brief.topic,
          goal: run.brief.goal,
          audience: run.brief.audience ?? "(not specified)",
          notes: run.brief.notes ?? "(none)",
          brief: run.research ? stringify(run.research).slice(0, BRIEF_CHARS) : "(no research brief available)",
          claims,
        }),
        user: "Design the strategy for this account now. Return only the JSON object.",
        json: true,
      };
  }
}

export interface LabParsed {
  /** Post text for writer-like prompts; absent otherwise. */
  text?: string;
  hashtags?: string[];
  /** Any structured output, for display. */
  value: unknown;
  checks?: CheckResult;
}

/** Parses a model's answer the way the stage would and runs the deterministic checks on drafts. */
export function parseLabOutput(key: LabPromptKey, raw: string, ctx: PipelineContext, run: RunSnapshot, account: RunAccountSnapshot): LabParsed {
  const json = extractJson(raw);
  switch (key) {
    case "writer":
    case "adapt":
    case "revise-request": {
      const schema = key === "adapt" ? AdaptOutputSchema : key === "revise-request" ? ReviseOutputSchema : DraftOutputSchema;
      const value = schema.parse(json);
      const checks = runChecks(checkInputFor(ctx, run, account, { text: value.text, hashtags: value.hashtags }, plannedMedia(account)));
      return { text: value.text, hashtags: value.hashtags, value, checks };
    }
    case "review":
      return { value: ReviewNotesOutputSchema.parse(json) };
    case "strategy":
      return { value: StrategyOutputSchema.parse(json) };
  }
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new z.ZodError([{ code: "custom", message: "No JSON object in the answer", path: [] }]);
  return JSON.parse(raw.slice(start, end + 1));
}
