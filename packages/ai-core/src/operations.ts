import { z } from "zod";
import type { AICapability, AIOperation } from "@platform/types";
import { AIError } from "./errors";
import { JSON_INSTRUCTION, brandSystemPrompt, platformGuidance, type BrandContext } from "./prompts";
import type { AIExecutor } from "./router";
import type { ChatMessage, GenerationTarget, RoutingContext } from "./types";

type Ctx = Omit<RoutingContext, "requiredCapability"> & { requiredCapability?: AICapability };

export const VariantSchema = z.object({
  platform: z.string(),
  text: z.string(),
  hashtags: z.array(z.string()).default([]),
  hook: z.string().optional(),
  cta: z.string().optional(),
});
export const VariantsResponseSchema = z.object({ variants: z.array(VariantSchema) });
export type Variants = z.infer<typeof VariantsResponseSchema>;

export const CalendarSchema = z.object({
  items: z.array(
    z.object({
      date: z.string(),
      platform: z.string(),
      title: z.string(),
      idea: z.string(),
      format: z.string().optional(),
    }),
  ),
});

export const QualityCheckSchema = z.object({
  score: z.number().min(0).max(100),
  issues: z.array(z.object({ type: z.string(), message: z.string(), severity: z.enum(["low", "medium", "high"]) })),
  suggestions: z.array(z.string()),
});

export const ReplySuggestionSchema = z.object({
  reply: z.string(),
  tone: z.string().optional(),
  needsHuman: z.boolean().default(false),
  reason: z.string().optional(),
});

/**
 * Parse model output as JSON, tolerating code fences and leading prose. Throws
 * an INVALID_REQUEST AIError (non-retryable) when the payload cannot be parsed
 * or fails schema validation, so callers surface a clear error.
 */
export function parseJsonOutput<T>(schema: z.ZodType<T>, text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (e) {
    throw new AIError(`Model returned invalid JSON: ${(e as Error).message}`, "INVALID_REQUEST", false);
  }
  const result = schema.safeParse(parsed);
  if (!result.success)
    throw new AIError(
      `Model output failed validation: ${result.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
      "INVALID_REQUEST",
      false,
    );
  return result.data;
}

/**
 * High-level content operations (spec §2.2 / §11). Each builds prompts from
 * brand context + platform guidance and returns validated structured output.
 */
export class ContentOperations {
  constructor(private readonly executor: AIExecutor) {}

  async generateVariants(
    ctx: Ctx,
    input: {
      idea: string;
      targets: GenerationTarget[];
      brand?: BrandContext;
      extraInstructions?: string;
      count?: number;
    },
  ): Promise<Variants> {
    const targets = input.targets.map((t) => `- ${platformGuidance(t)}`).join("\n");
    const messages: ChatMessage[] = [
      { role: "system", content: `${brandSystemPrompt(input.brand)}\n\n${JSON_INSTRUCTION}` },
      {
        role: "user",
        content:
          `Create ${input.count ?? 1} post variant(s) for EACH of these platforms from the idea below.\n${targets}\n\n` +
          `Idea / source:\n${input.idea}\n\n${input.extraInstructions ? `Extra instructions: ${input.extraInstructions}\n\n` : ""}` +
          `JSON shape: {"variants":[{"platform":"LINKEDIN","text":"...","hashtags":["..."],"hook":"...","cta":"..."}]}`,
      },
    ];
    const res = await this.executor.text(
      { ...ctx },
      { messages, json: true, operation: "PLATFORM_ADAPT", temperature: 0.8 },
    );
    const parsed = parseJsonOutput(VariantsResponseSchema, res.text);
    // Enforce hard limits regardless of what the model claims.
    for (const v of parsed.variants) {
      const target = input.targets.find((t) => t.platform === v.platform);
      if (target && v.text.length > target.maxLength) v.text = v.text.slice(0, target.maxLength);
    }
    return parsed;
  }

  async transform(
    ctx: Ctx,
    input: {
      text: string;
      operation: Extract<AIOperation, "REWRITE" | "SHORTEN" | "EXPAND" | "TRANSLATE">;
      brand?: BrandContext;
      instruction?: string;
      targetLanguage?: string;
      maxLength?: number;
    },
  ): Promise<string> {
    const verbs: Record<string, string> = {
      REWRITE: "Rewrite the text keeping the meaning but improving clarity and impact.",
      SHORTEN: `Shorten the text${input.maxLength ? ` to at most ${input.maxLength} characters` : ""} keeping the key message.`,
      EXPAND: "Expand the text with more detail and a stronger structure without inventing facts.",
      TRANSLATE: `Translate the text into ${input.targetLanguage ?? "English"}, adapting idioms naturally.`,
    };
    const messages: ChatMessage[] = [
      { role: "system", content: `${brandSystemPrompt(input.brand)}\nReturn only the resulting text, no preamble.` },
      {
        role: "user",
        content: `${verbs[input.operation]}${input.instruction ? ` ${input.instruction}` : ""}\n\nText:\n${input.text}`,
      },
    ];
    const res = await this.executor.text(ctx, { messages, operation: input.operation, temperature: 0.5 });
    return res.text.trim();
  }

  async hashtags(ctx: Ctx, input: { text: string; platform: string; count?: number }): Promise<string[]> {
    const messages: ChatMessage[] = [
      { role: "system", content: JSON_INSTRUCTION },
      {
        role: "user",
        content: `Suggest ${input.count ?? 10} relevant, specific hashtags for this ${input.platform} post. Mix broad and niche. JSON shape: {"hashtags":["#tag"]}\n\n${input.text}`,
      },
    ];
    const res = await this.executor.text(ctx, { messages, json: true, operation: "HASHTAGS", temperature: 0.4 });
    return parseJsonOutput(z.object({ hashtags: z.array(z.string()) }), res.text).hashtags.map((h) =>
      h.startsWith("#") ? h : `#${h}`,
    );
  }

  async hooksAndCtas(
    ctx: Ctx,
    input: { idea: string; platform: string; brand?: BrandContext },
  ): Promise<{ hooks: string[]; ctas: string[] }> {
    const messages: ChatMessage[] = [
      { role: "system", content: `${brandSystemPrompt(input.brand)}\n${JSON_INSTRUCTION}` },
      {
        role: "user",
        content: `Give 5 scroll-stopping opening hooks and 5 calls-to-action for a ${input.platform} post about:\n${input.idea}\nJSON shape: {"hooks":["..."],"ctas":["..."]}`,
      },
    ];
    const res = await this.executor.text(ctx, { messages, json: true, operation: "HOOKS", temperature: 0.9 });
    return parseJsonOutput(z.object({ hooks: z.array(z.string()), ctas: z.array(z.string()) }), res.text);
  }

  async calendar(
    ctx: Ctx,
    input: {
      theme: string;
      platforms: string[];
      startDate: string;
      days: number;
      postsPerWeek: number;
      brand?: BrandContext;
    },
  ) {
    const messages: ChatMessage[] = [
      { role: "system", content: `${brandSystemPrompt(input.brand)}\n${JSON_INSTRUCTION}` },
      {
        role: "user",
        content:
          `Plan a content calendar starting ${input.startDate} for ${input.days} days, about ${input.postsPerWeek} posts per week across ${input.platforms.join(", ")}. ` +
          `Theme: ${input.theme}. Vary formats (story, tip, behind-the-scenes, case study, question, announcement). ` +
          `JSON shape: {"items":[{"date":"YYYY-MM-DD","platform":"LINKEDIN","title":"...","idea":"...","format":"..."}]}`,
      },
    ];
    const res = await this.executor.text(ctx, {
      messages,
      json: true,
      operation: "CALENDAR",
      temperature: 0.8,
      maxTokens: 4000,
    });
    return parseJsonOutput(CalendarSchema, res.text);
  }

  async qualityCheck(ctx: Ctx, input: { text: string; platform: string; brand?: BrandContext }) {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `${brandSystemPrompt(input.brand)}\nYou are now acting as a strict editor.\n${JSON_INSTRUCTION}`,
      },
      {
        role: "user",
        content: `Review this ${input.platform} post for clarity, brand fit, banned phrases, factual risk, spelling and platform fit. JSON shape: {"score":0-100,"issues":[{"type":"...","message":"...","severity":"low|medium|high"}],"suggestions":["..."]}\n\n${input.text}`,
      },
    ];
    const res = await this.executor.text(ctx, { messages, json: true, operation: "QUALITY_CHECK", temperature: 0.2 });
    return parseJsonOutput(QualityCheckSchema, res.text);
  }

  async suggestReply(
    ctx: Ctx,
    input: {
      conversation: { direction: "INBOUND" | "OUTBOUND"; text: string }[];
      brand?: BrandContext;
      knowledge?: string[];
    },
  ) {
    const transcript = input.conversation
      .slice(-20)
      .map((m) => `${m.direction === "INBOUND" ? "Customer" : "Agent"}: ${m.text}`)
      .join("\n");
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${brandSystemPrompt({ ...input.brand, knowledge: input.knowledge })}\nYou draft WhatsApp replies for a support/sales agent. Be concise (under 500 characters), polite, and never promise refunds, prices or delivery dates unless they appear in the knowledge. ` +
          `If the request needs a human (complaint, legal, payment dispute, unclear), set needsHuman=true.\n${JSON_INSTRUCTION}`,
      },
      {
        role: "user",
        content: `Conversation:\n${transcript}\n\nJSON shape: {"reply":"...","tone":"...","needsHuman":false,"reason":"..."}`,
      },
    ];
    const res = await this.executor.text(ctx, { messages, json: true, operation: "REPLY_SUGGEST", temperature: 0.4 });
    return parseJsonOutput(ReplySuggestionSchema, res.text);
  }
}
