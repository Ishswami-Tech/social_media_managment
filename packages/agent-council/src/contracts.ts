/**
 * Shared contracts for the Agent Council. Everything the pipeline reads or
 * writes goes through these types and the `AgentRunStore` port, so the pure
 * pipeline (this package) stays free of Prisma, queues and HTTP; the web app
 * provides the adapters.
 *
 * Hard rule: nothing in this package publishes. The pipeline ends with a
 * recommendation per account; approval and publishing are the application's.
 */
import type {
  AIProviderName,
  AgentAssurance,
  AgentDraftRole,
  AgentPublishMode,
  AgentRunStatus,
  ClaimStatus,
  Platform,
  PlatformCapabilities,
} from "@platform/types";
import type { AIExecutor, ModelRouter, RoutingContext, Tool } from "@platform/ai-core";
import type { Brief } from "@platform/research";

// ---------------------------------------------------------------------------
// Campaign input & account knowledge
// ---------------------------------------------------------------------------

export interface CampaignBrief {
  topic: string;
  goal: string;
  audience?: string;
  notes?: string;
  platforms: Platform[];
}

/** One connected account taking part in a run, with everything the council knows about it. */
export interface RunAccount {
  runAccountId: string;
  socialAccountId: string;
  platform: Platform;
  displayName: string;
  accountType: string;
  capabilities: PlatformCapabilities;
  profile: AccountBrain;
}

/** Account Brain (mirrors the AccountProfile row; all sections optional). */
export interface AccountBrain {
  identity?: { brand?: string; industry?: string; positioning?: string; products?: string[] };
  audience?: { personas?: string[]; painPoints?: string[]; desiredOutcomes?: string[] };
  voice?: { tone?: string; vocabulary?: string[]; sentenceStyle?: string; forbiddenLanguage?: string[]; examples?: string[] };
  content?: { pillars?: string[]; topics?: string[]; formats?: string[]; ctaPreferences?: string[]; forbiddenTopics?: string[] };
  performance?: {
    sampleSize?: number;
    confidence?: number;
    bestHooks?: string[];
    bestTopics?: string[];
    bestFormats?: string[];
    bestCtas?: string[];
    bestPostingWindows?: string[];
  };
  humanFeedback?: {
    preferences?: { text: string; weight: number; source: "edit" | "rejection" | "comment" | "explicit"; at: string }[];
  };
}

// ---------------------------------------------------------------------------
// Stage outputs
// ---------------------------------------------------------------------------

export interface ClaimRecord {
  id: string;
  statement: string;
  sourceUrl?: string;
  sourceTitle?: string;
  evidence?: string;
  confidence: number;
  status: ClaimStatus;
}

export interface AccountStrategy {
  angle: string;
  hookType: string;
  format: string;
  cta: string;
  keyPoints: string[];
  claimIds: string[];
  rationale: string;
  mediaConcept?: string;
}

export interface DraftCandidate {
  /** Blind label shown to the judge (A, B, C…) */
  label: string;
  role: AgentDraftRole;
  provider: AIProviderName;
  model: string;
  promptKey: string;
  promptVersion: number;
  promptHash: string;
  text: string;
  hashtags: string[];
  claimIds: string[];
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface CheckIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface CheckResult {
  ok: boolean;
  issues: CheckIssue[];
}

export interface JudgeVerdict {
  /** Blind label of the winner */
  winner: string;
  scores: { label: string; score: number; rationale: string }[];
  /** Elements worth borrowing from non-winning candidates */
  borrow: string[];
}

export interface AccountRecommendation {
  runAccountId: string;
  finalText: string;
  hashtags: string[];
  claimIds: string[];
  mediaConcept?: string;
  winnerDraftLabel: string;
}

// ---------------------------------------------------------------------------
// Ports the application implements
// ---------------------------------------------------------------------------

export interface RunSnapshot {
  id: string;
  organizationId: string;
  status: AgentRunStatus;
  assurance: AgentAssurance;
  publishMode: AgentPublishMode;
  brief: CampaignBrief;
  maxCents: number;
  spentCents: number;
  research?: Brief;
  claims: ClaimRecord[];
  accounts: (RunAccount & {
    strategy?: AccountStrategy;
    drafts: DraftCandidate[];
    recommendation?: AccountRecommendation;
  })[];
}

export interface StepEvent {
  step: string;
  status: "STARTED" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  provider?: string;
  model?: string;
  promptKey?: string;
  promptVersion?: number;
  promptHash?: string;
  input?: unknown;
  output?: unknown;
  validation?: unknown;
  costCents?: number;
  latencyMs?: number;
  error?: string;
}

/** Persistence port: the worker's Prisma implementation lives in apps/web. */
export interface AgentRunStore {
  load(runId: string): Promise<RunSnapshot>;
  setStatus(runId: string, status: AgentRunStatus, extra?: { currentStep?: string; error?: string; blockedReason?: string }): Promise<void>;
  saveResearch(runId: string, brief: Brief, claims: ClaimRecord[]): Promise<ClaimRecord[]>;
  saveStrategy(runAccountId: string, strategy: AccountStrategy): Promise<void>;
  saveDraft(runId: string, runAccountId: string, draft: DraftCandidate, extra?: { checks?: CheckResult; judgeScore?: number; judgeRationale?: string }): Promise<string>;
  saveRecommendation(rec: AccountRecommendation & { winnerDraftId?: string }): Promise<void>;
  addEvent(runId: string, event: StepEvent): Promise<void>;
  addCost(runId: string, cents: number): Promise<void>;
}

/** Budget port: reserve before calling a model, settle with the actual cost afterwards. */
export interface BudgetPort {
  reserve(organizationId: string, runId: string, cents: number): Promise<{ reservationId: string } | { denied: string }>;
  settle(reservationId: string, actualCents: number): Promise<void>;
  release(reservationId: string): Promise<void>;
}

/** Circuit-breaker port shared by all workers (persisted in ProviderHealth). */
export interface ProviderHealthPort {
  isOpen(provider: AIProviderName): Promise<boolean>;
  recordSuccess(provider: AIProviderName, latencyMs: number): Promise<void>;
  recordFailure(provider: AIProviderName, error: string): Promise<void>;
}

/** Everything a stage needs to call models and tools for one organization. */
export interface PipelineContext {
  executor: AIExecutor;
  router: ModelRouter;
  /** Routing context factory (capability + optional explicit model) */
  routing: (capability: "text" | "json", pref?: { provider?: AIProviderName; model?: string }) => Promise<Omit<RoutingContext, "requiredCapability"> & { requiredCapability?: "text" | "json" }>;
  /** Providers the organization can use, in preference order (writers are spread across them). */
  availableProviders: AIProviderName[];
  /** Optional allow-list of "PROVIDER::model" strings from organization settings. */
  allowedModels?: string[];
  researchTools: Tool[];
  store: AgentRunStore;
  budget: BudgetPort;
  health: ProviderHealthPort;
  /** Deterministic clock/random for tests */
  now?: () => Date;
}
