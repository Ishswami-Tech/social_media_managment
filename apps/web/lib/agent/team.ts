/**
 * The council as a standing team: who is working right now, what each agent
 * has done lately, and an activity stream across every campaign in the
 * workspace. All of it comes from the stored run events.
 */
import type { Prisma } from "@platform/database";
import {
  buildTranscript,
  modelLabel,
  PROGRESS_STAGE_KEYS,
  stageOfStep,
  type ProgressAccount,
  type ProgressEvent,
  type ProgressStageKey,
  type TranscriptMessage,
} from "@platform/agent-council/progress";
import { prisma } from "@/lib/db";
import { progressEventSelect, toProgressAccount, toProgressEvent } from "@/lib/agent/progress";
import { PRODUCING_STATUSES } from "@/components/home/labels";

const WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAX_EVENTS = 3_000;
const ACTIVITY_TAKE = 40;
const TOP_MODELS = 2;

export interface TeamMember {
  key: ProgressStageKey;
  /** The campaign this agent is on right now, if any. */
  working: { runId: string; topic: string; since: string } | null;
  /** Distinct campaigns touched in the window. */
  runs: number;
  calls: number;
  failures: number;
  avgLatencyMs: number | null;
  /** Busiest models in the window, as display names. */
  models: string[];
  lastActive: string | null;
}

export interface ActivityItem extends TranscriptMessage {
  runId: string;
  topic: string;
}

export interface TeamSnapshot {
  members: TeamMember[];
  activity: ActivityItem[];
  /** Campaigns in progress right now. */
  live: number;
  at: string;
}

const STATUS_STAGE: Partial<Record<string, ProgressStageKey>> = {
  RESEARCHING: "research",
  STRATEGIZING: "strategy",
  DRAFTING: "drafting",
  REVIEWING: "review",
  JUDGING: "judge",
  ADAPTING: "adapt",
};

type EventRow = Prisma.AgentRunEventGetPayload<{ select: typeof progressEventSelect }> & { runId: string };

/** Which agent a run's status puts on duty, or the stage its current step names. */
function stageOfRun(status: string, currentStep: string | null): ProgressStageKey | null {
  const byStatus = STATUS_STAGE[status];
  if (byStatus) return byStatus;
  return currentStep ? stageOfStep(currentStep.split(":")[0] ?? currentStep) : null;
}

export async function loadTeam(organizationId: string): Promise<TeamSnapshot> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [liveRuns, rows] = await Promise.all([
    prisma.agentRun.findMany({
      where: { organizationId, status: { in: [...PRODUCING_STATUSES] } },
      select: { id: true, topic: true, status: true, currentStep: true, startedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentRunEvent.findMany({
      where: { run: { organizationId }, createdAt: { gte: since } },
      select: { ...progressEventSelect, runId: true },
      orderBy: { createdAt: "desc" },
      take: MAX_EVENTS,
    }),
  ]);

  const members = PROGRESS_STAGE_KEYS.map((key) => summarize(key, rows as EventRow[], liveRuns));
  const activity = await recentActivity(organizationId, rows as EventRow[]);
  return { members, activity, live: liveRuns.length, at: new Date().toISOString() };
}

function summarize(
  key: ProgressStageKey,
  rows: readonly EventRow[],
  liveRuns: readonly { id: string; topic: string; status: string; currentStep: string | null; startedAt: Date | null; createdAt: Date }[],
): TeamMember {
  const own = rows.filter((r) => stageOfStep(r.step) === key);
  const runs = new Set(own.map((r) => r.runId)).size;
  const done = own.filter((r) => r.status === "SUCCEEDED" && r.latencyMs > 0);
  const avgLatencyMs = done.length ? Math.round(done.reduce((s, r) => s + r.latencyMs, 0) / done.length) : null;
  const byModel = new Map<string, number>();
  for (const r of own) {
    if (!r.model) continue;
    const label = modelLabel(r.model, r.provider) ?? r.model;
    byModel.set(label, (byModel.get(label) ?? 0) + 1);
  }
  const models = [...byModel.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_MODELS).map(([label]) => label);
  const onDuty = key === "ready" ? undefined : liveRuns.find((run) => stageOfRun(run.status, run.currentStep) === key);
  return {
    key,
    working: onDuty ? { runId: onDuty.id, topic: onDuty.topic, since: (onDuty.startedAt ?? onDuty.createdAt).toISOString() } : null,
    runs,
    calls: own.length,
    failures: own.filter((r) => r.status === "FAILED").length,
    avgLatencyMs,
    models,
    lastActive: own[0]?.createdAt.toISOString() ?? null,
  };
}

/** The newest messages across campaigns, each with the campaign it belongs to. */
async function recentActivity(organizationId: string, rows: readonly EventRow[]): Promise<ActivityItem[]> {
  const runIds = [...new Set(rows.map((r) => r.runId))].slice(0, 12);
  if (runIds.length === 0) return [];
  const runs = await prisma.agentRun.findMany({
    where: { id: { in: runIds }, organizationId },
    select: {
      id: true,
      topic: true,
      accounts: {
        select: { id: true, platform: true, decision: true, finalText: true, editedText: true, socialAccount: { select: { displayName: true } } },
      },
      _count: { select: { claims: true } },
    },
  });
  const items: ActivityItem[] = [];
  for (const run of runs) {
    const events: ProgressEvent[] = rows.filter((r) => r.runId === run.id).map(toProgressEvent);
    const accounts: ProgressAccount[] = run.accounts.map(toProgressAccount);
    for (const message of buildTranscript(events, accounts, { claimCount: run._count.claims })) {
      items.push({ ...message, runId: run.id, topic: run.topic });
    }
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, ACTIVITY_TAKE);
}
