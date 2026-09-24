import type { AIProviderName } from "@platform/types";
import {
  AIError,
  AIExecutor,
  ModelRouter,
  type AIProvider,
  type ModelInfo,
  type TextRequest,
  type TextResponse,
  type Tool,
} from "@platform/ai-core";
import type {
  AccountRecommendation,
  AccountStrategy,
  AgentRunStore,
  BudgetPort,
  CheckResult,
  ClaimRecord,
  DraftCandidate,
  JudgeVerdict,
  PipelineContext,
  SkillCard,
  ReviewNote,
  RunSnapshot,
  StepEvent,
} from "../../src/contracts";
import { createCircuitBreaker } from "../../src/circuit-breaker";

// ---------------------------------------------------------------------------
// Scripted provider
// ---------------------------------------------------------------------------

export const CATALOGUE: ModelInfo[] = [
  { provider: "GOOGLE", model: "gemini-test", capabilities: ["text", "json"], inputCostPerM: 0.5, outputCostPerM: 1 },
  { provider: "OPENAI", model: "gpt-test", capabilities: ["text", "json"], inputCostPerM: 1, outputCostPerM: 2 },
  { provider: "ANTHROPIC", model: "claude-test", capabilities: ["text", "json"], inputCostPerM: 2, outputCostPerM: 4 },
];

export interface ScriptedCall {
  provider: AIProviderName;
  model: string;
  stage: string;
  system: string;
  user: string;
  temperature?: number;
  json?: boolean;
  hasTools: boolean;
}

export interface Script {
  calls: ScriptedCall[];
  /** Incremented per writer call so the drafts of one account differ. */
  writerCalls: number;
  /** Stages that should throw instead of answering. */
  failing: Set<string>;
  /** Providers that answer every call with a 429 quota error. */
  outOfQuota: Set<AIProviderName>;
  /** Skill ids the scripted planner picks. */
  skillPicks: string[];
  /** Draft text fragments the scripted platform reviewer sends back for a fix. */
  reviseOnReview: string[];
  /** The scripted editor answers a revise request with text far over any limit. */
  overlongRevision: boolean;
}

export const createScript = (): Script => ({
  calls: [],
  writerCalls: 0,
  failing: new Set(),
  outOfQuota: new Set(),
  skillPicks: [],
  reviseOnReview: [],
  overlongRevision: false,
});

/** Draft A is clean; draft B states a number no claim supports, so it must be revised. */
export const WRITER_TEXTS = [
  "We rebuilt onboarding around one idea: fewer steps before the first win.\n\nOperations leads tell us the first week decides everything.\n\nWhat is slowing your team down?",
  "Our pilot reached 4.2 million people last quarter.\n\nThat number hid the real story: setup was still manual.\n\nWhat would you change first?",
] as const;

export const REVISED_TEXT =
  "Our pilot reached far more people than we expected.\n\nThat hid the real story: setup was still manual.\n\nWhat would you change first?";

export const SYNTHESIZED_TEXT =
  "We rebuilt onboarding around one idea: fewer steps before the first win.\n\nOperations leads tell us the first week decides everything.\n\nWhat would you change first?";

const BRIEF = {
  title: "Onboarding speed decides retention",
  summary: "Operations teams abandon tools that take a week to set up. Guided onboarding flows change that.",
  keyPoints: ["Guided flows shorten setup", "The first week decides retention"],
  angles: [{ hook: "The first week decides everything", why: "Concrete and testable" }],
  postIdeas: [],
  sources: [{ title: "Onboarding report 2025", url: "https://example.com/report", note: "Setup time data" }],
  caveats: [],
};

const CLAIMS = {
  claims: [
    {
      statement: "Teams using a guided onboarding flow reduced setup time by 38% in 2025.",
      sourceUrl: "https://example.com/report",
      sourceTitle: "Onboarding report 2025",
      evidence: "guided onboarding reduced median setup time by 38%",
      confidence: 0.9,
      status: "SUPPORTED",
    },
    {
      statement: "Most operations teams plan to consolidate tools next year.",
      confidence: 0.4,
      status: "UNVERIFIED",
    },
  ],
};

const STRATEGY = {
  angle: "The first week decides whether a tool survives",
  hookType: "question",
  format: "text post",
  cta: "Tell us what slows your setup down",
  keyPoints: ["Name the cost of slow setup", "Show the guided flow", "Invite a reply"],
  claimIds: ["cl_1", "cl_missing"],
  rationale: "Operations leads respond to concrete time savings.",
  mediaConcept: "Split screen: a cluttered checklist next to a three-step guided flow.",
};

function stageOf(system: string): string {
  return (system.split("\n")[0] ?? "").replace("STAGE: ", "").trim();
}

function platformOf(system: string): string {
  return system.match(/PLATFORM: (\w+)/)?.[1] ?? "LINKEDIN";
}

function answer(stage: string, system: string, script: Script): string {
  switch (stage) {
    case "RESEARCH":
      return JSON.stringify(BRIEF);
    case "CLAIMS":
      return JSON.stringify(CLAIMS);
    case "STRATEGY":
      return JSON.stringify(STRATEGY);
    case "WRITER": {
      const index = script.writerCalls % WRITER_TEXTS.length;
      script.writerCalls += 1;
      return JSON.stringify({ text: WRITER_TEXTS[index], hashtags: ["#onboarding"], claimIds: ["cl_1", "nope"] });
    }
    case "REVISION":
      return JSON.stringify({ text: REVISED_TEXT, hashtags: ["#onboarding"], claimIds: [] });
    case "REVISE REQUEST":
      return JSON.stringify({
        text: script.overlongRevision ? "x".repeat(5_000) : "Shorter. Fewer steps before the first win.\n\nWhat would you change first?",
        hashtags: ["#onboarding"],
        claimIds: [],
        note: "Cut it to the point.",
      });
    case "SKILLS":
      return JSON.stringify({ picks: script.skillPicks.map((id) => ({ id, why: "fits the platform" })) });
    case "PLATFORM REVIEW": {
      const text = system.match(/DRAFT\n([\s\S]*?)\nHashtags:/)?.[1] ?? "";
      const revise = script.reviseOnReview.some((needle) => text.includes(needle));
      return JSON.stringify({
        verdict: revise ? "REVISE" : "PASS",
        issues: ['"the first week decides everything" reads as a claim; soften it'],
      });
    }
    case "JUDGE":
      return JSON.stringify({
        winner: "A",
        scores: [
          { label: "A", score: 48, rationale: '"fewer steps before the first win" is concrete' },
          { label: "B", score: 39, rationale: "The opening buries the point" },
        ],
        borrow: ["from B: the closing question"],
      });
    case "SYNTHESIS":
      return JSON.stringify({ text: SYNTHESIZED_TEXT, hashtags: ["#onboarding"], claimIds: [] });
    case "ADAPT":
      return JSON.stringify({
        text: platformOf(system) === "INSTAGRAM" ? `${SYNTHESIZED_TEXT}\n\nLink in bio.` : SYNTHESIZED_TEXT,
        hashtags: platformOf(system) === "INSTAGRAM" ? ["#onboarding", "#operations"] : ["#onboarding"],
        claimIds: [],
        mediaConcept: "Three-step guided flow shown on a laptop screen.",
      });
    default:
      return "{}";
  }
}

function messageText(req: TextRequest, role: "system" | "user"): string {
  const message = req.messages.find((m) => m.role === role);
  if (!message) return "";
  return typeof message.content === "string"
    ? message.content
    : message.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}

/** Deterministic provider that answers from the stage header of the system prompt. */
export function createScriptedProvider(name: AIProviderName, script: Script): AIProvider {
  return {
    name,
    async generateText(req: TextRequest): Promise<TextResponse> {
      const system = messageText(req, "system");
      const user = messageText(req, "user");
      const stage = stageOf(system);
      script.calls.push({
        provider: name,
        model: req.model,
        stage,
        system,
        user,
        temperature: req.temperature,
        json: req.json,
        hasTools: Boolean(req.tools?.length),
      });
      if (script.outOfQuota.has(name)) throw AIError.fromHttp(name, 429, { error: { message: `${name} quota exceeded` } });
      if (script.failing.has(stage)) throw new Error(`scripted failure in ${stage}`);
      const text = answer(stage, system, script);
      return {
        text,
        usage: { inputTokens: Math.ceil(system.length / 4), outputTokens: Math.ceil(text.length / 4) },
        model: req.model,
        provider: name,
        latencyMs: 3,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

export interface MemoryStore {
  store: AgentRunStore;
  snapshot: () => RunSnapshot;
  events: StepEvent[];
  statuses: string[];
  recommendations: (AccountRecommendation & { winnerDraftId?: string })[];
  judgements: { draftId: string; score: number; rationale: string }[];
  draftChecks: Map<string, CheckResult>;
}

/** Full `AgentRunStore` over a snapshot that is replaced, never mutated in place. */
export function createMemoryStore(initial: RunSnapshot): MemoryStore {
  let snapshot = initial;
  let sequence = 0;
  const events: StepEvent[] = [];
  const statuses: string[] = [];
  const recommendations: (AccountRecommendation & { winnerDraftId?: string })[] = [];
  const judgements: { draftId: string; score: number; rationale: string }[] = [];
  const draftChecks = new Map<string, CheckResult>();

  const mapAccount = (runAccountId: string, update: (a: RunSnapshot["accounts"][number]) => RunSnapshot["accounts"][number]) => {
    snapshot = {
      ...snapshot,
      accounts: snapshot.accounts.map((a) => (a.runAccountId === runAccountId ? update(a) : a)),
    };
  };

  const store: AgentRunStore = {
    async load() {
      return snapshot;
    },
    async setStatus(_runId, status, extra) {
      statuses.push(status);
      snapshot = { ...snapshot, status, currentStep: extra?.currentStep ?? snapshot.currentStep };
      if (extra?.currentStep) events.push({ step: extra.currentStep, status: "STARTED" });
    },
    async markStep(_runId, currentStep) {
      snapshot = { ...snapshot, currentStep };
    },
    async saveResearch(_runId, research, claims) {
      const withIds: ClaimRecord[] = claims.map((c, i) => ({ ...c, id: `cl_${i + 1}` }));
      snapshot = { ...snapshot, research, claims: withIds };
      return withIds;
    },
    async saveSkills(_runId, skillIds) {
      snapshot = { ...snapshot, skillIds };
    },
    async saveStrategy(runAccountId, strategy: AccountStrategy) {
      mapAccount(runAccountId, (a) => ({ ...a, strategy }));
    },
    async saveDraft(_runId, runAccountId, draft: DraftCandidate, extra) {
      sequence += 1;
      const id = `draft_${sequence}`;
      if (extra?.checks) draftChecks.set(id, extra.checks);
      mapAccount(runAccountId, (a) => ({ ...a, drafts: [...a.drafts, { ...draft, id }] }));
      return id;
    },
    async saveRecommendation(rec) {
      recommendations.push(rec);
      mapAccount(rec.runAccountId, (a) => ({ ...a, recommendation: rec }));
    },
    async addEvent(_runId, event) {
      events.push(event);
    },
    async addCost(_runId, cents) {
      snapshot = { ...snapshot, spentCents: snapshot.spentCents + cents };
    },
    async updateDraftJudgement(draftId, score, rationale) {
      judgements.push({ draftId, score, rationale });
    },
    async saveVerdict(runAccountId, verdict: JudgeVerdict) {
      mapAccount(runAccountId, (a) => ({ ...a, verdict }));
    },
    async saveReviewNotes(runAccountId, notes: ReviewNote[]) {
      mapAccount(runAccountId, (a) => ({ ...a, reviewNotes: notes }));
    },
  };

  return { store, snapshot: () => snapshot, events, statuses, recommendations, judgements, draftChecks };
}

// ---------------------------------------------------------------------------
// In-memory budget
// ---------------------------------------------------------------------------

export interface MemoryBudget {
  budget: BudgetPort;
  reserved: number[];
  settled: { reservationId: string; cents: number }[];
  released: string[];
}

/** Reserves against a hard cap; everything above it is denied like the real port. */
export function createMemoryBudget(capCents: number): MemoryBudget {
  const reserved: number[] = [];
  const settled: { reservationId: string; cents: number }[] = [];
  const released: string[] = [];
  const open = new Map<string, number>();
  let committed = 0;
  let sequence = 0;

  const budget: BudgetPort = {
    async reserve(_organizationId, _runId, cents) {
      const outstanding = [...open.values()].reduce((sum, c) => sum + c, 0);
      if (committed + outstanding + cents > capCents) return { denied: "budget exceeded" };
      sequence += 1;
      const reservationId = `res_${sequence}`;
      open.set(reservationId, cents);
      reserved.push(cents);
      return { reservationId };
    },
    async settle(reservationId, actualCents) {
      open.delete(reservationId);
      committed += actualCents;
      settled.push({ reservationId, cents: actualCents });
    },
    async release(reservationId) {
      open.delete(reservationId);
      released.push(reservationId);
    },
  };
  return { budget, reserved, settled, released };
}

// ---------------------------------------------------------------------------
// Pipeline context
// ---------------------------------------------------------------------------

export const NOOP_TOOL: Tool = {
  definition: { name: "web_search", description: "Search the web", parameters: { type: "object", properties: {} } },
  run: async () => [{ title: "Onboarding report 2025", url: "https://example.com/report" }],
};

export interface TestContext {
  ctx: PipelineContext;
  script: Script;
  memory: MemoryStore;
  money: MemoryBudget;
}

export function createTestContext(
  run: RunSnapshot,
  options: {
    availableProviders?: AIProviderName[];
    allowedModels?: string[];
    capCents?: number;
    script?: Script;
    skills?: SkillCard[];
  } = {},
): TestContext {
  const script = options.script ?? createScript();
  const availableProviders = options.availableProviders ?? ["OPENAI", "ANTHROPIC", "GOOGLE"];
  const router = new ModelRouter(CATALOGUE);
  const providers = new Map<AIProviderName, AIProvider>(
    availableProviders.map((name) => [name, createScriptedProvider(name, script)]),
  );
  const executor = new AIExecutor(providers, router, () => ({ apiKey: "test" }));
  const memory = createMemoryStore(run);
  const money = createMemoryBudget(options.capCents ?? 10_000);
  const ctx: PipelineContext = {
    executor,
    router,
    routing: async (capability, pref) => ({ user: pref, availableProviders, requiredCapability: capability }),
    availableProviders,
    allowedModels: options.allowedModels,
    researchTools: [NOOP_TOOL],
    ...(options.skills ? { skills: options.skills } : {}),
    store: memory.store,
    budget: money.budget,
    health: createCircuitBreaker(),
    recentTexts: [],
  };
  return { ctx, script, memory, money };
}
