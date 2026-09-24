import Link from "next/link";
import type { Prisma } from "@platform/database";
import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { composeFinalText } from "@/lib/agent/apply";
import { loadRecommendationImages, type RecommendationImage } from "@/lib/agent/media";
import { performanceFor } from "@/lib/agent/performance";
import { runProgressSelect, toRunInitial } from "@/lib/agent/progress";
import { selectableModels } from "@/lib/ai";
import { pluginSummaries } from "@/lib/plugins";
import { listSkillSummaries } from "@/lib/skills";
import {
  ComposerBar,
  ExamplePrompts,
  type ComposerBarAccount,
  type ComposerBarModel,
} from "@/components/home/composer-bar";
import { Thread, type ThreadAccount, type ThreadProps, type PostResults } from "@/components/home/thread";
import { TodayBar, type TodayStats } from "@/components/home/today-bar";
import { Reveal } from "@/components/ui/reveal";

export const metadata = { title: "Home" };

/** How much of the conversation the feed keeps in view. */
const MAX_THREADS = 20;

const EXAMPLE_PROMPTS = [
  "A lesson we learned shipping faster this quarter",
  "Announce our new integration and why it matters",
  "A customer story about cutting setup time in half",
] as const;

/** Everything a thread needs: the live view, plus what people read and decide on. */
const threadSelect = {
  ...runProgressSelect,
  createdById: true,
  assurance: true,
  skillIds: true,
  preferredModel: true,
  wantsImage: true,
  blockedReason: true,
  error: true,
  accounts: {
    select: {
      ...runProgressSelect.accounts.select,
      finalHashtags: true,
      strategy: true,
      mediaAssetIds: true,
      postId: true,
      socialAccountId: true,
      winnerDraftId: true,
      drafts: { select: { id: true, judgeScore: true } },
      socialAccount: { select: { displayName: true, avatarUrl: true, profile: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.AgentRunSelect;

type ThreadRow = Prisma.AgentRunGetPayload<{ select: typeof threadSelect }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `AgentRunAccount.strategy` is free-form JSON; only the one line people read is taken. */
function readAngle(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["angle", "rationale", "hookType"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/** Learned posting windows from the account profile, in plain words. */
function bestWindows(profile: { performance: Prisma.JsonValue | null } | null): string[] {
  const perf = profile?.performance;
  if (!isRecord(perf) || !Array.isArray(perf.bestPostingWindows)) return [];
  return perf.bestPostingWindows.filter((w): w is string => typeof w === "string").slice(0, 3);
}

function toThreadAccount(
  account: ThreadRow["accounts"][number],
  images: ReadonlyMap<string, RecommendationImage>,
  results: ReadonlyMap<string, PostResults>,
): ThreadAccount {
  const base = account.editedText ?? account.finalText ?? "";
  const imageId = account.mediaAssetIds.find((id) => images.has(id));
  return {
    id: account.id,
    platform: account.platform,
    displayName: account.socialAccount.displayName,
    avatarUrl: account.socialAccount.avatarUrl,
    bestWindows: bestWindows(account.socialAccount.profile),
    results: account.postId ? (results.get(`${account.postId}:${account.socialAccountId}`) ?? null) : null,
    text: base ? composeFinalText(base, account.finalHashtags) : "",
    why: readAngle(account.strategy),
    image: imageId ? (images.get(imageId) ?? null) : null,
    performance: performanceFor(account),
    decision: account.decision,
    postId: account.postId,
  };
}

const metric = (m: unknown, key: string): number | undefined =>
  isRecord(m) && typeof m[key] === "number" ? (m[key] as number) : undefined;

/** Latest analytics for the published variants behind these posts, keyed by `postId:socialAccountId`. */
async function loadResults(postIds: string[]): Promise<Map<string, PostResults>> {
  const ids = [...new Set(postIds)];
  if (ids.length === 0) return new Map();
  const variants = await prisma.postVariant.findMany({
    where: { postId: { in: ids }, status: "PUBLISHED" },
    select: {
      postId: true,
      socialAccountId: true,
      publishedAt: true,
      externalUrl: true,
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { metrics: true, capturedAt: true } },
    },
  });
  return new Map(
    variants.map((v) => {
      const snap = v.snapshots[0];
      return [
        `${v.postId}:${v.socialAccountId}`,
        {
          publishedAt: v.publishedAt?.toISOString() ?? null,
          externalUrl: v.externalUrl,
          impressions: metric(snap?.metrics, "impressions"),
          likes: metric(snap?.metrics, "likes"),
          comments: metric(snap?.metrics, "comments"),
          capturedAt: snap?.capturedAt.toISOString() ?? null,
        },
      ];
    }),
  );
}

/** The numbers on the Today bar: what waits, what went out, what is next, what did best. */
async function loadTodayStats(organizationId: string): Promise<TodayStats> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [awaiting, publishedThisMonth, next, snapshots] = await Promise.all([
    prisma.agentRun.count({ where: { organizationId, status: "AWAITING_APPROVAL" } }),
    prisma.postVariant.count({ where: { post: { organizationId }, status: "PUBLISHED", publishedAt: { gte: monthStart } } }),
    prisma.post.findFirst({
      where: { organizationId, status: { in: ["SCHEDULED", "APPROVED", "QUEUED"] }, scheduledAt: { gt: new Date() } },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true },
    }),
    prisma.analyticsSnapshot.findMany({
      where: { organizationId, scope: "POST", capturedAt: { gte: monthStart }, postVariant: { status: "PUBLISHED" } },
      select: { metrics: true, postVariant: { select: { postId: true } } },
    }),
  ]);
  const top = snapshots
    .map((s) => ({ impressions: metric(s.metrics, "impressions") ?? 0, postId: s.postVariant?.postId ?? "" }))
    .filter((s) => s.postId && s.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)[0];
  return {
    awaiting,
    publishedThisMonth,
    nextScheduledAt: next?.scheduledAt?.toISOString() ?? null,
    topReach: top ?? null,
  };
}

/** "OPENAI::gpt-5" → the model's short display name, or the bare model id. */
function modelChip(preferred: string | null, models: ComposerBarModel[]): string | null {
  if (!preferred) return null;
  const match = models.find((m) => `${m.provider}::${m.model}` === preferred);
  const name = match?.displayName ?? preferred.split("::")[1] ?? preferred;
  return name.split("(")[0]?.trim() ?? name;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const ctx = await requireOrg();
  const { forbidden } = await searchParams;
  const organizationId = ctx.organization.id;
  const canCreate = ctx.can("ai:generate");

  const [accounts, runs, skills, plugins, models] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId, status: "CONNECTED" },
      select: { id: true, platform: true, displayName: true },
      orderBy: [{ platform: "asc" }, { displayName: "asc" }],
    }),
    prisma.agentRun.findMany({
      where: { organizationId },
      select: threadSelect,
      orderBy: { createdAt: "desc" },
      take: MAX_THREADS,
    }),
    listSkillSummaries(organizationId).catch(() => []),
    pluginSummaries(organizationId).catch(() => []),
    selectableModels(organizationId).catch(() => []),
  ]);

  const composerAccounts: ComposerBarAccount[] = accounts;
  const composerModels: ComposerBarModel[] = models.map((m) => ({
    provider: m.provider,
    model: m.model,
    displayName: m.displayName,
    capabilities: [...m.capabilities],
  }));
  const customSkills = skills
    .filter((s) => s.source === "custom")
    .map((s) => ({ id: s.id, name: s.name, description: s.description }));
  const skillName = (id: string) => customSkills.find((s) => s.id === id)?.name ?? id.replace(/^custom:/, "");

  const isAdmin = ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.actor.isSuperAdmin === true;
  const canApprove = ctx.can("content:approve");
  const [images, results, stats] = await Promise.all([
    loadRecommendationImages(
      organizationId,
      runs.flatMap((run) => run.accounts.flatMap((a) => a.mediaAssetIds)),
    ).catch(() => new Map<string, RecommendationImage>()),
    loadResults(runs.flatMap((run) => run.accounts.flatMap((a) => (a.postId ? [a.postId] : [])))),
    loadTodayStats(organizationId),
  ]);

  // Oldest at the top, newest just above the composer — like any conversation.
  const threads: ThreadProps[] = [...runs].reverse().map((run) => ({
    runId: run.id,
    topic: run.topic,
    initial: toRunInitial(run),
    accounts: run.accounts.map((a) => toThreadAccount(a, images, results)),
    skills: run.skillIds.map(skillName),
    model: modelChip(run.preferredModel, composerModels),
    assurance: run.assurance,
    wantsImage: run.wantsImage,
    blockedReason: run.blockedReason,
    error: run.error,
    canDecide: canApprove && (run.createdById !== ctx.user.id || isAdmin),
    canManage: ctx.can("content:create"),
  }));

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1">
        <div className="flex items-center justify-between gap-3 pb-4">
          <h1 className="text-sm font-medium text-muted-foreground">Your posts, start to finish</h1>
          <Link href="/posts" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            See all posts
          </Link>
        </div>
        <TodayBar stats={stats} />

        {forbidden && (
          <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            That page is not available to your role. Ask someone who owns this workspace.
          </p>
        )}

        {threads.length === 0 ? (
          <div className="grid gap-4 py-10">
            <h2 className="text-2xl font-semibold tracking-tight">Tell me what to post about.</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              One agent researches it with sources, one plans the angle, several writers on different models
              draft it, a reviewer checks it for the platform, a blind judge picks the best, and you approve.
              Want a whole month at once? Start on{" "}
              <Link href="/plan" className="underline underline-offset-4">
                Plan
              </Link>
              .
            </p>
            {canCreate && <ExamplePrompts prompts={EXAMPLE_PROMPTS} />}
          </div>
        ) : (
          <div className="grid gap-10 pb-6">
            {threads.map((thread, index) => (
              <Reveal key={thread.runId} index={index}>
                <Thread {...thread} />
              </Reveal>
            ))}
          </div>
        )}
      </div>

      {canCreate ? (
        <ComposerBar
          accounts={composerAccounts}
          skills={customSkills}
          plugins={plugins.map((p) => ({ slug: p.slug, name: p.name, kind: p.kind }))}
          models={composerModels}
        />
      ) : (
        <p className="sticky bottom-0 -mx-4 border-t bg-background/85 px-4 py-3 text-sm text-muted-foreground backdrop-blur md:-mx-6 md:px-6">
          Your role can read posts but not write them.
        </p>
      )}
    </div>
  );
}
