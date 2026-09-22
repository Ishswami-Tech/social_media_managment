/**
 * The run driver. One call advances the run by exactly one stage so the worker
 * keeps control (pause, retry, budget, dead-letter) between stages and every
 * stage boundary is a persisted, replayable checkpoint.
 */
import {
  assertRunTransition,
  nextPipelineStage,
  type AgentPublishMode,
  type AgentRunStatus,
} from "@platform/types";
import type { PipelineContext, RunSnapshot } from "./contracts";
import { adaptingStage } from "./stages/adapt";
import { judgeStage } from "./stages/judge";
import { researchStage } from "./stages/research";
import { reviewStage } from "./stages/review";
import { strategyStage } from "./stages/strategy";
import { writersStage } from "./stages/writers";

export type Stage = (ctx: PipelineContext, run: RunSnapshot) => Promise<void>;

/** Stage executed on entering each pipeline status. */
export const STAGES: Readonly<Partial<Record<AgentRunStatus, Stage>>> = Object.freeze({
  RESEARCHING: researchStage,
  STRATEGIZING: strategyStage,
  DRAFTING: writersStage,
  REVIEWING: reviewStage,
  JUDGING: judgeStage,
  ADAPTING: adaptingStage,
});

export interface AdvanceResult {
  status: AgentRunStatus;
  /** True when the pipeline has nothing left to do (the policy gate takes over). */
  done: boolean;
}

/**
 * Runs the stage that follows the run's current status. Anything outside the
 * pipeline (paused, blocked, awaiting approval, finished) is returned untouched
 * so the caller can decide what to do.
 */
export const stepDone = (status: AgentRunStatus): string => `${status}:done`;
export const stepRunning = (status: AgentRunStatus): string => `${status}:running`;

/**
 * A run found at a pipeline status whose checkpoint is not `<STATUS>:done` was
 * interrupted mid-stage (worker restart, crash, stalled job). Re-run that
 * stage rather than treating it as finished.
 */
export function interruptedStage(run: Pick<RunSnapshot, "status" | "currentStep">): AgentRunStatus | undefined {
  return STAGES[run.status] && run.currentStep !== stepDone(run.status) ? run.status : undefined;
}

export async function advanceRun(ctx: PipelineContext, runId: string): Promise<AdvanceResult> {
  const run = await ctx.store.load(runId);
  const resume = interruptedStage(run);
  const target = resume ?? nextPipelineStage(run.status);
  const stage = target ? STAGES[target] : undefined;
  if (!target || !stage) return { status: run.status, done: true };
  if (resume) {
    await ctx.store.markStep(runId, stepRunning(target));
  } else {
    assertRunTransition(run.status, target);
    await ctx.store.setStatus(runId, target, { currentStep: stepRunning(target) });
  }
  await stage(ctx, { ...run, status: target });
  await ctx.store.markStep(runId, stepDone(target));
  return { status: target, done: target === "ADAPTING" };
}

/** Drives the run through every remaining stage (worker loop and tests). */
export async function runPipelineToCompletion(ctx: PipelineContext, runId: string): Promise<AdvanceResult> {
  let result = await advanceRun(ctx, runId);
  let guard = Object.keys(STAGES).length + 1;
  while (!result.done && guard-- > 0) {
    result = await advanceRun(ctx, runId);
  }
  return result;
}

export interface PublishPolicy {
  /** Publish mode chosen for this run. */
  publishMode: AgentPublishMode;
  /** Organization-wide publish mode. */
  orgMode: AgentPublishMode;
  /** The run creator holds `content:publish`. */
  creatorCanPublish: boolean;
  /** `agentAutoPublish` of every target account. */
  accountsAutoPublish: boolean[];
  checksPassed: boolean;
  budgetOk: boolean;
}

/**
 * Status after ADAPTING (spec "Automatic publishing policy"): MANUAL runs are a
 * recommendation only, automatic publishing needs every condition to hold, and
 * everything else waits for a human.
 */
export function decideNextAfterAdapting(policy: PublishPolicy): "AWAITING_APPROVAL" | "APPROVED" | "COMPLETED" {
  if (policy.publishMode === "MANUAL") return "COMPLETED";
  const automatic =
    policy.publishMode === "AUTOMATIC" &&
    policy.orgMode === "AUTOMATIC" &&
    policy.creatorCanPublish &&
    policy.accountsAutoPublish.length > 0 &&
    policy.accountsAutoPublish.every(Boolean) &&
    policy.checksPassed &&
    policy.budgetOk;
  return automatic ? "APPROVED" : "AWAITING_APPROVAL";
}
