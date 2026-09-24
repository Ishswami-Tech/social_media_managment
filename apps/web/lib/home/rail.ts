/**
 * The side rail on Home: what waits for a decision, what goes out next, how
 * the last posts did, and which models actually wrote today. All four are
 * read straight from the database for one organization.
 */
import { prisma } from "@/lib/db";
import { modelLabel, providerName } from "@platform/agent-council/progress";

export interface WaitingItem {
  runId: string;
  topic: string;
  accounts: string[];
  /** Best judge score among the winning drafts, 0-100, when known. */
  score: number | null;
  waitingSince: string;
}

export interface UpcomingItem {
  postId: string;
  text: string;
  platforms: string[];
  scheduledAt: string;
  timezone: string;
}

export interface ResultItem {
  postId: string;
  text: string;
  platform: string;
  publishedAt: string | null;
  impressions?: number;
  likes?: number;
  comments?: number;
}

export interface ModelUse {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  drafts: number;
}

export interface HomeRail {
  waiting: WaitingItem[];
  upcoming: UpcomingItem[];
  results: ResultItem[];
  models: ModelUse[];
}

const RAIL_LIMIT = 5;
const MODELS_WINDOW_MS = 24 * 60 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads one numeric field from a normalised metrics JSON blob. */
export function metric(m: unknown, key: string): number | undefined {
  return isRecord(m) && typeof m[key] === "number" ? (m[key] as number) : undefined;
}

async function loadWaiting(organizationId: string): Promise<WaitingItem[]> {
  const runs = await prisma.agentRun.findMany({
    where: { organizationId, status: "AWAITING_APPROVAL" },
    orderBy: { updatedAt: "asc" },
    take: RAIL_LIMIT,
    select: {
      id: true,
      topic: true,
      updatedAt: true,
      accounts: {
        select: {
          decision: true,
          winnerDraftId: true,
          socialAccount: { select: { displayName: true } },
          drafts: { select: { id: true, judgeScore: true } },
        },
      },
    },
  });
  return runs.map((run) => {
    const pending = run.accounts.filter((a) => a.decision === "PENDING");
    const scores = pending
      .map((a) => a.drafts.find((d) => d.id === a.winnerDraftId)?.judgeScore)
      .filter((s): s is number => typeof s === "number");
    return {
      runId: run.id,
      topic: run.topic,
      accounts: pending.map((a) => a.socialAccount.displayName),
      score: scores.length ? Math.round(Math.max(...scores)) : null,
      waitingSince: run.updatedAt.toISOString(),
    };
  });
}

async function loadUpcoming(organizationId: string): Promise<UpcomingItem[]> {
  const posts = await prisma.post.findMany({
    where: { organizationId, status: { in: ["SCHEDULED", "APPROVED", "QUEUED"] }, scheduledAt: { gt: new Date() } },
    orderBy: { scheduledAt: "asc" },
    take: RAIL_LIMIT,
    select: { id: true, title: true, masterText: true, scheduledAt: true, timezone: true, variants: { select: { platform: true } } },
  });
  return posts.flatMap((p) =>
    p.scheduledAt
      ? [
          {
            postId: p.id,
            text: p.title || p.masterText,
            platforms: [...new Set(p.variants.map((v) => v.platform))],
            scheduledAt: p.scheduledAt.toISOString(),
            timezone: p.timezone,
          },
        ]
      : [],
  );
}

async function loadResults(organizationId: string): Promise<ResultItem[]> {
  const variants = await prisma.postVariant.findMany({
    where: { post: { organizationId }, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: RAIL_LIMIT,
    select: {
      postId: true,
      platform: true,
      publishedAt: true,
      post: { select: { title: true, masterText: true } },
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { metrics: true } },
    },
  });
  return variants.map((v) => {
    const m = v.snapshots[0]?.metrics;
    return {
      postId: v.postId,
      text: v.post.title || v.post.masterText,
      platform: v.platform,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      impressions: metric(m, "impressions"),
      likes: metric(m, "likes"),
      comments: metric(m, "comments"),
    };
  });
}

/** Which models wrote drafts in the last day, busiest first. Answers "is it only using one model?". */
async function loadModelsToday(organizationId: string): Promise<ModelUse[]> {
  const since = new Date(Date.now() - MODELS_WINDOW_MS);
  const drafts = await prisma.agentDraft.groupBy({
    by: ["provider", "model"],
    where: { runAccount: { run: { organizationId, createdAt: { gte: since } } } },
    _count: { _all: true },
  });
  return drafts
    .map((d) => ({
      provider: d.provider,
      providerLabel: providerName(d.provider),
      model: d.model,
      label: modelLabel(d.model, d.provider) ?? d.model,
      drafts: d._count._all,
    }))
    .sort((a, b) => b.drafts - a.drafts);
}

export async function loadHomeRail(organizationId: string): Promise<HomeRail> {
  const [waiting, upcoming, results, models] = await Promise.all([
    loadWaiting(organizationId),
    loadUpcoming(organizationId),
    loadResults(organizationId),
    loadModelsToday(organizationId),
  ]);
  return { waiting, upcoming, results, models };
}
