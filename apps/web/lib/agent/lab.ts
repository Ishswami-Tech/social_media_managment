/**
 * Prompt lab for Super Admins: run one stage prompt from a real campaign
 * against several models and compare the answers with the pipeline's own
 * checks and the reach estimate. Runs go through the executor directly, so
 * nothing is written to the campaign; usage is still metered.
 */
import { z } from "zod";
import {
  LAB_PROMPT_KEYS,
  listPrompts,
  parseLabOutput,
  renderLabPrompt,
  type LabPromptKey,
} from "@platform/agent-council";
import { estimatePerformance, type PerformanceEstimate } from "@platform/agent-council/scoring";
import { AI_PROVIDERS, type AIProviderName } from "@platform/types";
import { aiRuntime, discoverModels } from "@/lib/ai";
import { buildPipelineContext } from "@/lib/agent/context";
import { createPrismaRunStore } from "@/lib/agent/store";
import { prisma } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";

const MAX_MODELS = 4;
const LAB_MAX_TOKENS = 4_000;

export const labInput = z.object({
  promptKey: z.enum(LAB_PROMPT_KEYS),
  runId: z.string().min(1),
  accountId: z.string().min(1),
  models: z.array(z.string().regex(/^[A-Z0-9_]+::.+$/)).min(1).max(MAX_MODELS),
  lane: z.enum(["A", "B", "C"]).optional(),
  instruction: z.string().trim().max(1000).optional(),
  temperature: z.number().min(0).max(1).optional(),
});
export type LabInput = z.infer<typeof labInput>;

export interface LabModelResult {
  provider: string;
  model: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  raw: string;
  text?: string;
  hashtags?: string[];
  value?: unknown;
  checks?: { ok: boolean; issues: { code: string; message: string; severity: string }[] };
  estimate?: Pick<PerformanceEstimate, "score" | "band" | "strengths" | "improvements">;
}

export interface LabResult {
  promptKey: LabPromptKey;
  promptVersion: number;
  system: string;
  user: string;
  results: LabModelResult[];
}

export interface LabRunOption {
  id: string;
  topic: string;
  status: string;
  organization: string;
  createdAt: string;
  accounts: { id: string; platform: string; displayName: string; hasText: boolean }[];
}

/** Recent campaigns across organizations, newest first, with their accounts. */
export async function labRuns(take = 25): Promise<LabRunOption[]> {
  const runs = await prisma.agentRun.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      topic: true,
      status: true,
      createdAt: true,
      organization: { select: { name: true } },
      accounts: { select: { id: true, platform: true, finalText: true, socialAccount: { select: { displayName: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  return runs.map((r) => ({
    id: r.id,
    topic: r.topic,
    status: r.status,
    organization: r.organization.name,
    createdAt: r.createdAt.toISOString(),
    accounts: r.accounts.map((a) => ({ id: a.id, platform: a.platform, displayName: a.socialAccount.displayName, hasText: Boolean(a.finalText) })),
  }));
}

export function labPrompts(): { key: string; version: number; hash: string; template: string }[] {
  return listPrompts()
    .filter((p) => (LAB_PROMPT_KEYS as readonly string[]).includes(p.key))
    .map((p) => ({ key: p.key, version: p.version, hash: p.hash, template: p.template }));
}

/** Text-capable models the run's organization can reach, as "PROVIDER::model". */
export async function labModels(runId: string): Promise<{ id: string; label: string; source: string }[]> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { organizationId: true } });
  if (!run) throw notFound("Campaign");
  const models = await discoverModels(run.organizationId);
  return models
    .filter((m) => m.capabilities.includes("json") || m.capabilities.includes("text"))
    .map((m) => ({ id: `${m.provider}::${m.model}`, label: `${m.displayName} · ${m.provider}`, source: m.source }));
}

function parseModelId(id: string): { provider: AIProviderName; model: string } {
  const [provider, ...rest] = id.split("::");
  if (!provider || !(AI_PROVIDERS as readonly string[]).includes(provider) || rest.length === 0) throw badRequest(`Unknown model "${id}"`);
  return { provider: provider as AIProviderName, model: rest.join("::") };
}

export async function runPromptLab(input: LabInput): Promise<LabResult> {
  const header = await prisma.agentRun.findUnique({ where: { id: input.runId }, select: { organizationId: true, createdById: true } });
  if (!header) throw notFound("Campaign");
  const [ctx, snapshot, ai] = await Promise.all([
    buildPipelineContext(header.organizationId, input.runId),
    createPrismaRunStore().load(input.runId),
    aiRuntime(header.organizationId, header.createdById),
  ]);
  const account = snapshot.accounts.find((a) => a.runAccountId === input.accountId);
  if (!account) throw badRequest("That account is not part of this campaign");
  const prompt = renderLabPrompt(input.promptKey, ctx, snapshot, account, { lane: input.lane, instruction: input.instruction });
  const version = listPrompts().find((p) => p.key === input.promptKey)?.version ?? 0;

  const results = await Promise.all(
    input.models.map(async (id): Promise<LabModelResult> => {
      const { provider, model } = parseModelId(id);
      const started = Date.now();
      try {
        const routing = await ai.routing("json", { provider, model });
        const res = await ai.executor.text(
          { ...routing, allowFallback: false, requiredCapability: "json" },
          {
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user },
            ],
            json: prompt.json,
            temperature: input.temperature ?? 0.5,
            maxTokens: LAB_MAX_TOKENS,
            operation: "GENERATE",
          },
        );
        const base: LabModelResult = {
          provider,
          model,
          ok: true,
          latencyMs: Date.now() - started,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          raw: res.text,
        };
        try {
          const parsed = parseLabOutput(input.promptKey, res.text, ctx, snapshot, account);
          const estimate =
            parsed.text !== undefined
              ? estimatePerformance({ text: parsed.text, hashtags: parsed.hashtags ?? [], platform: account.platform, brain: account.profile, strategy: account.strategy })
              : undefined;
          return {
            ...base,
            text: parsed.text,
            hashtags: parsed.hashtags,
            value: parsed.value,
            ...(parsed.checks ? { checks: { ok: parsed.checks.ok, issues: parsed.checks.issues.map((i) => ({ code: i.code, message: i.message, severity: i.severity })) } } : {}),
            ...(estimate ? { estimate: { score: estimate.score, band: estimate.band, strengths: estimate.strengths, improvements: estimate.improvements } } : {}),
          };
        } catch (parseError) {
          return { ...base, ok: false, error: `Answer did not match the expected shape: ${parseError instanceof Error ? parseError.message.slice(0, 200) : String(parseError)}` };
        }
      } catch (error) {
        return {
          provider,
          model,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 300) : String(error),
          latencyMs: Date.now() - started,
          inputTokens: 0,
          outputTokens: 0,
          raw: "",
        };
      }
    }),
  );
  return { promptKey: input.promptKey, promptVersion: version, system: prompt.system, user: prompt.user, results };
}
