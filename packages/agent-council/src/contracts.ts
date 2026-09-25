import type { LiveBus } from "./live";
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
  /** Story bank: real moments, numbers and lessons the organization recorded for the writers to draw from. */
  stories?: { title?: string; text: string }[];
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
  /** Angles the other strategists proposed, kept for the record when a council sat. */
  alternatives?: { angle: string; hookType: string; model?: string }[];
}

export interface DraftCandidate {
  /**
   * Persistent id assigned by the store (`saveDraft` return value). Additive:
   * `AgentRunStore.load` should populate it so later stages can attach
   * judgements (`updateDraftJudgement`) and recommendations (`winnerDraftId`).
   */
  id?: string;
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

/** Cross-review output (HIGH_ASSURANCE): issues a second provider found in a draft, keyed by blind label. */
export interface ReviewNote {
  label: string;
  issues: string[];
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

/** A playbook the organization can attach to a campaign (imported SKILL.md or written by hand). */
export interface SkillCard {
  /** Stable id, e.g. `custom:linkedin-post-writer`. */
  id: string;
  name: string;
  description: string;
  /** Platforms the playbook is written for; empty means it applies everywhere. */
  platforms: string[];
  /** Applied to every campaign without being picked. */
  always: boolean;
  instructions: string;
}

export interface RunSnapshot {
  id: string;
  organizationId: string;
  status: AgentRunStatus;
  /** Playbooks attached to this campaign: what the person picked plus what the skills step added. */
  skillIds?: string[];
  /** Checkpoint marker: `<STAGE>:running` while a stage executes, `<STAGE>:done` once it finished. */
  currentStep?: string | null;
  assurance: AgentAssurance;
  publishMode: AgentPublishMode;
  brief: CampaignBrief;
  maxCents: number;
  spentCents: number;
  research?: Brief;
  claims: ClaimRecord[];
  /**
   * Additive: the organization's recently published texts (duplicate check).
   * Falls back to `PipelineContext.recentTexts` when absent.
   */
  recentTexts?: string[];
  accounts: (RunAccount & {
    strategy?: AccountStrategy;
    drafts: DraftCandidate[];
    /** Additive: cross-review notes saved by the review stage (HIGH_ASSURANCE only). */
    reviewNotes?: ReviewNote[];
    /** Additive: blind judge verdict saved by the judge stage. */
    verdict?: JudgeVerdict;
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
  /** Persists the checkpoint marker without changing the status (a stage finished or was re-entered). */
  markStep(runId: string, currentStep: string): Promise<void>;
  saveResearch(runId: string, brief: Brief, claims: ClaimRecord[]): Promise<ClaimRecord[]>;
  /** Additive (skills step): persist the playbooks chosen for the run. */
  saveSkills(runId: string, skillIds: string[]): Promise<void>;
  saveStrategy(runAccountId: string, strategy: AccountStrategy): Promise<void>;
  saveDraft(runId: string, runAccountId: string, draft: DraftCandidate, extra?: { checks?: CheckResult; judgeScore?: number; judgeRationale?: string }): Promise<string>;
  saveRecommendation(rec: AccountRecommendation & { winnerDraftId?: string }): Promise<void>;
  addEvent(runId: string, event: StepEvent): Promise<void>;
  addCost(runId: string, cents: number): Promise<void>;
  /**
   * Additive (judge stage): attach the blind judge's score and rationale to a
   * draft that was saved earlier with `saveDraft` (identified by the returned id).
   */
  updateDraftJudgement(draftId: string, score: number, rationale: string): Promise<void>;
  /**
   * Additive (judge stage): persist the verdict for an account so the ADAPTING
   * stage (a later `advanceRun` call) can read `accounts[].verdict` from the snapshot.
   */
  saveVerdict(runAccountId: string, verdict: JudgeVerdict): Promise<void>;
  /**
   * Additive (review stage, HIGH_ASSURANCE): persist cross-review notes so the
   * judge stage can read `accounts[].reviewNotes` from the snapshot.
   */
  saveReviewNotes(runAccountId: string, notes: ReviewNote[]): Promise<void>;
}

/** Budget port: reserve before calling a model, settle with the actual cost afterwards. */
export interface BudgetPort {
  reserve(organizationId: string, runId: string, cents: number): Promise<{ reservationId: string } | { denied: string }>;
  settle(reservationId: string, actualCents: number): Promise<void>;
  release(reservationId: string): Promise<void>;
}

/** Circuit-breaker port shared by all workers (persisted in ProviderHealth). */
export interface ProviderHealthPort {
  /** Whether the breaker is open; a check on an expired breaker lets one probe call through. */
  isOpen(provider: AIProviderName): Promise<boolean>;
  /**
   * Additive: true when the breaker is closed, without touching it. Used to
   * plan seats ahead of the calls; `isOpen` would hand the single half-open
   * probe to the planner instead of to the call.
   */
  isHealthy?(provider: AIProviderName): Promise<boolean>;
  recordSuccess(provider: AIProviderName, latencyMs: number): Promise<void>;
  recordFailure(provider: AIProviderName, error: string): Promise<void>;
}

/** Everything a stage needs to call models and tools for one organization. */
export interface PipelineContext {
  executor: AIExecutor;
  /** Additive: where in-flight model text is pushed for people watching. Absent means no live text. */
  live?: LiveBus;
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
  /**
   * Additive: the organization's recently published texts (last ~50) used by
   * the duplicate check. Empty/undefined disables duplicate detection.
   */
  recentTexts?: string[];
  /**
   * Additive: the organization's playbook catalogue. The skills step picks from
   * it; the writing and review stages inject the chosen, platform-relevant ones.
   */
  skills?: SkillCard[];
  /**
   * Additive: "PROVIDER::model" pairs that failed for a model-level reason
   * (retired, no tool support) during this job. Shared by every stage of the
   * run so no later agent tries them again; never persisted.
   */
  deadModels?: Set<string>;
  /**
   * Additive: "PROVIDER::model" pairs other agents of this run have already
   * used. A call with no explicit model steers away from them while another
   * model is available, so the team spreads over the catalogue instead of
   * everyone landing on the top entry. Never persisted.
   */
  modelsInUse?: Set<string>;
  /**
   * Additive: how many models sit behind each single-seat agent. 3 means the
   * researcher asks three models and merges, the strategist hears three angles,
   * the reviewer pools three readings and the judge is three judges voting.
   * Absent or 1 is one call per seat.
   */
  councilSize?: number;
  /**
   * Additive: skill playbooks attached to this campaign. Appended to the system
   * prompt of every stage that writes text (writer, revision, synthesis, adapt).
   */
  skillInstructions?: string;
  /** Deterministic clock/random for tests */
  now?: () => Date;
}
