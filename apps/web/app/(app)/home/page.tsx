import { requireOrg } from "@/lib/session";
import { compactNumber } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { runProgressSelect, toRunInitial } from "@/lib/agent/progress";
import { selectableModels, resolveAuth } from "@/lib/ai";
import { pluginSummaries } from "@/lib/plugins";
import { listSkillSummaries } from "@/lib/skills";
import { monthlyBudgetStatus } from "@/lib/agent/budget";
import { providerHealthSummary } from "@/lib/agent/provider-health";
import { platformName, providerName } from "@platform/agent-council/progress";
import {
  loadActivity,
  loadAlsoWaiting,
  loadQueues,
  loadSpend,
  loadTodayAgenda,
  averageRunCents,
  typicalRunMs,
  type TodayAgenda,
} from "@/lib/home/overview";
import { ComposerBar, type ComposerBarAccount, type ComposerBarModel } from "@/components/home/composer-bar";
import { ViewOnly, WritingNowCard } from "@/components/home/thread";
import { AlsoWaiting, ApproveAllButton } from "@/components/home/also-waiting";
import type { ProviderStatus } from "@/components/home/provider-strip";
import {
  ActivityLog,
  AttentionCard,
  GoingOutSoon,
  HowItsGoing,
  KpiStrip,
  Learned,
  NextSevenDays,
  NextSteps,
  PlanCard,
  SectionHead,
  SetupCard,
  SpendCard,
  SystemStatusCard,
  TodayHero,
  TodayTopBar,
  WhatsAppCard,
  type CouncilHealth,
  type KpiTile,
  type NextStep,
} from "@/components/home/today-bar";

export const metadata = { title: "Today" };

/** Errors older than this no longer colour a provider. */
const PROVIDER_ERROR_WINDOW_MS = 30 * 60_000;
const WRITING_STATUSES = ["QUEUED", "RESEARCHING", "STRATEGIZING", "DRAFTING", "REVIEWING", "JUDGING", "ADAPTING", "PAUSED"] as const;
const DEFAULT_MAX_ACTIVE_RUNS = 5;

const FALLBACK_IDEAS = [
  "A lesson we learned shipping faster this quarter",
  "Announce our new integration and why it matters",
  "A customer story about cutting setup time in half",
] as const;

/** Each configured provider with what the circuit breaker knows about it. */
async function providerStatuses(organizationId: string): Promise<ProviderStatus[]> {
  const [{ available }, health] = await Promise.all([resolveAuth(organizationId), providerHealthSummary()]);
  const now = Date.now();
  return available.map((provider) => {
    const h = health.find((r) => r.provider === provider);
    const recentFailure = h?.lastFailureAt ? now - Date.parse(h.lastFailureAt) < PROVIDER_ERROR_WINDOW_MS : false;
    if (h?.open) return { provider, state: "cooling", reason: h.lastError ?? undefined, avgLatencyMs: h.avgLatencyMs };
    if (recentFailure && h?.lastError && h.failureCount > 0) return { provider, state: "failing", reason: h.lastError, avgLatencyMs: h.avgLatencyMs };
    return { provider, state: "ok", avgLatencyMs: h?.avgLatencyMs };
  });
}

/** "Good afternoon" in the organization's time zone. */
function greeting(timeZone: string): string {
  let hour = new Date().getHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()));
  } catch {
    // An unknown zone falls back to server time.
  }
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function joinAnd(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

/** The opening sentence: what needs the person (in the signal colour), then the rest. */
function summary(awaiting: number, agenda: TodayAgenda): { lead: string | null; rest: string } {
  const accounts = agenda.attention.filter((a) => a.kind === "account").length;
  const failures = agenda.attention.length - accounts;
  const chats = agenda.inbox.length;
  const others = [
    accounts ? `${plural(accounts, "account needs", "accounts need")} reconnecting` : null,
    failures ? `${plural(failures, "post needs", "posts need")} another try` : null,
    chats ? `${plural(chats, "customer is", "customers are")} waiting on WhatsApp` : null,
  ].filter((x): x is string => x !== null);
  const lead = awaiting ? `${plural(awaiting, "post needs", "posts need")} your approval` : null;
  const tail = others.length || awaiting ? "Everything else is on track." : "Nothing needs you right now.";
  if (!lead) return { lead: null, rest: others.length ? `${joinAnd(others).replace(/^./, (c) => c.toUpperCase())}. ${tail}` : tail };
  return { lead, rest: others.length ? `${joinAnd(others)}. ${tail}` : tail.replace(/^Everything/, "everything") };
}

function health(providers: ProviderStatus[]): { state: CouncilHealth; text: string } {
  if (providers.length === 0) return { state: "down", text: "No AI provider set up" };
  const bad = providers.filter((p) => p.state !== "ok");
  if (bad.length === providers.length) return { state: "down", text: "Every AI provider is failing" };
  if (bad.length) return { state: "degraded", text: `Running slower · ${bad.map((b) => platformLabel(b.provider)).join(", ")} busy` };
  return { state: "ok", text: "Council is running normally" };
}

function platformLabel(provider: string): string {
  return providerName(provider);
}

function ageText(iso: string | undefined): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const ctx = await requireOrg();
  const { forbidden } = await searchParams;
  const organizationId = ctx.organization.id;
  const canCreate = ctx.can("ai:generate");
  const canApprove = ctx.can("content:approve");
  const canManage = ctx.can("content:create");
  // Opening a run (review page, council room, live stream) needs one of these; read-only roles get plain lists.
  const canViewRuns = canCreate || canApprove;
  const canSettings = ctx.can("org:settings");
  const isAdmin = ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.actor.isSuperAdmin === true;

  const [accounts, writing, skills, plugins, models, settings, whatsAppCount, providers] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId, status: "CONNECTED" },
      select: { id: true, platform: true, displayName: true },
      orderBy: [{ platform: "asc" }, { displayName: "asc" }],
    }),
    prisma.agentRun.findMany({
      where: { organizationId, status: { in: [...WRITING_STATUSES] } },
      select: { ...runProgressSelect, assurance: true, platforms: true },
      orderBy: { createdAt: "desc" },
    }),
    listSkillSummaries(organizationId).catch(() => []),
    pluginSummaries(organizationId).catch(() => []),
    selectableModels(organizationId).catch(() => []),
    prisma.organizationSettings.findUnique({ where: { organizationId }, select: { timezone: true, agentMaxActiveRuns: true } }),
    prisma.whatsAppAccount.count({ where: { organizationId } }),
    providerStatuses(organizationId).catch(() => [] as ProviderStatus[]),
  ]);
  const tz = settings?.timezone ?? "UTC";

  const composerModels: ComposerBarModel[] = models.map((m) => ({
    provider: m.provider,
    model: m.model,
    displayName: m.displayName,
    capabilities: [...m.capabilities],
  }));
  const customSkills = skills.filter((s) => s.source === "custom").map((s) => ({ id: s.id, name: s.name, description: s.description }));

  const [waiting, agenda, budget, typicalMs, recentSpend, activity, queues, spend] = await Promise.all([
    loadAlsoWaiting(organizationId).catch(() => []),
    loadTodayAgenda(organizationId, {
      hasAiProvider: composerModels.some((m) => m.capabilities.includes("text")),
      hasWhatsApp: whatsAppCount > 0 && ctx.can("whatsapp:view"),
      timeZone: tz,
      canEditMemory: canSettings,
    }),
    canSettings ? monthlyBudgetStatus(organizationId).catch(() => null) : null,
    typicalRunMs(organizationId).catch(() => null),
    averageRunCents(organizationId).catch(() => null),
    loadActivity(organizationId).catch(() => []),
    canSettings ? loadQueues(organizationId).catch(() => []) : [],
    canSettings ? loadSpend(organizationId, tz).catch(() => null) : null,
  ]);

  const decidable = canApprove ? waiting.filter((w) => w.createdById !== ctx.user.id || isAdmin) : [];
  const live = writing[0];
  // Nothing is being written: keep the council on the page with the latest run.
  const latest = live || !canViewRuns
    ? null
    : await prisma.agentRun.findFirst({
        where: { organizationId },
        select: { ...runProgressSelect, assurance: true, platforms: true },
        orderBy: { createdAt: "desc" },
      });
  if (!canViewRuns) {
    for (const d of agenda.week) for (const it of d.items) it.href = "/posts";
    for (const a of agenda.attention) if (a.kind === "blocked_run") a.href = "/posts";
  }
  const sum = summary(agenda.awaitingCount, agenda);
  const council = health(providers);
  const now = new Date();
  const firstName = ctx.user.name.split(" ")[0] ?? ctx.user.name;
  const spentCents = budget ? budget.spentCents + budget.reservedCents : 0;
  const activeRuns = writing.filter((r) => r.status !== "QUEUED" && r.status !== "PAUSED").length;
  const queued = writing.filter((r) => r.status === "QUEUED").length;
  const avgCents = recentSpend;

  // ---- next steps, most urgent first, at most four
  const steps: NextStep[] = [];
  if (decidable.length)
    steps.push({
      icon: "check",
      tone: "signal",
      title: `Approve ${plural(decidable.length === waiting.length ? agenda.awaitingCount : decidable.length, "post", "posts")}`,
      detail: decidable[0]?.goesOutAt
        ? `The first one goes out ${new Date(decidable[0].goesOutAt).toLocaleDateString("en-US", { weekday: "long", timeZone: tz })}`
        : "Nothing goes out until you say so",
      href: decidable.length === 1 ? `/review/${decidable[0]!.runId}` : "#waiting",
      cta: "Review",
    });
  const firstFix = agenda.attention[0];
  if (firstFix)
    steps.push({
      icon: firstFix.kind === "account" ? "link" : "alert",
      tone: firstFix.kind === "account" ? "warn" : "danger",
      title: firstFix.kind === "account" ? firstFix.title.replace(" sign-in expired", "").replace(/^/, "Reconnect ") : firstFix.title,
      detail: firstFix.detail,
      href: firstFix.href,
      cta: firstFix.action.label,
    });
  if (agenda.inbox.length)
    steps.push({
      icon: "inbox",
      tone: "teal",
      title: `Reply to ${plural(agenda.inbox.length, "WhatsApp chat", "WhatsApp chats")}`,
      detail: `Oldest has waited ${ageText(agenda.inbox.at(-1)?.at ?? undefined)}`,
      href: "/whatsapp/inbox",
      cta: "Open inbox",
    });
  if (canCreate && (!agenda.plan || agenda.plan.daysLeft <= 7)) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString("en-US", { month: "long" });
    steps.push({
      icon: "calendar",
      tone: "info",
      title: agenda.plan ? `Plan ${next}` : "Plan a month of posts",
      detail: agenda.plan ? `This plan ends in ${plural(agenda.plan.daysLeft, "day", "days")}` : "The council drafts the ideas; you start the ones you like",
      href: "/plan",
      cta: "Start plan",
    });
  } else if (canSettings) {
    const setup = agenda.setup.find((s) => !s.done);
    if (setup) steps.push({ icon: "sparkle", tone: "info", title: setup.label, detail: "Part of getting set up", href: setup.href, cta: "Start" });
  }

  // ---- numbers at a glance (Detailed)
  const nextOut = agenda.upcoming[0];
  const kpis: KpiTile[] = [
    { label: "Waiting on you", value: String(agenda.awaitingCount), note: waiting[0] ? `oldest ${ageText(waiting[0].waitingSince)}` : "nothing waiting", signal: waiting.length > 0, href: "#waiting" },
    {
      label: "Published · 30 days",
      value: String(agenda.results.published),
      note: `across ${plural(agenda.results.accountsPublishing, "account", "accounts")}`,
      href: "/posts?filter=published",
    },
    {
      label: "Next going out",
      value: nextOut
        ? new Date(nextOut.scheduledAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).replace(",", "")
        : "—",
      note: nextOut ? nextOut.platforms.map(platformName).join(" · ") : "nothing scheduled",
      href: "/posts?view=calendar",
    },
    {
      label: "Reach · 30 days",
      value: compactNumber(agenda.results.reach.value),
      note:
        agenda.results.reach.change === null
          ? "no earlier period"
          : `${agenda.results.reach.change >= 0 ? "+" : "−"}${Math.round(Math.abs(agenda.results.reach.change) * 100)}% vs previous 30`,
      href: "/analytics",
    },
    ...(budget
      ? [
          {
            label: `Spend · ${now.toLocaleDateString("en-US", { month: "long", timeZone: tz })}`,
            value: `$${(spentCents / 100).toFixed(2)}`,
            note: `of $${(budget.budgetCents / 100).toFixed(0)}${avgCents ? ` · avg $${(avgCents / 100).toFixed(2)} / post` : ""}`,
            href: "/settings?tab=ai",
          },
        ]
      : []),
    {
      label: "Posts in progress",
      value: `${activeRuns} / ${settings?.agentMaxActiveRuns ?? DEFAULT_MAX_ACTIVE_RUNS}`,
      note: `${queued} queued`,
    },
  ];

  const ideas = [
    ...(agenda.plan?.next ? [agenda.plan.next.title] : []),
    ...FALLBACK_IDEAS,
  ].slice(0, 3);
  const typicalMin = typicalMs ? Math.max(1, Math.round(typicalMs / 60_000)) : null;
  const estimate = avgCents ? `≈ $${(avgCents / 100).toFixed(2)}${typicalMin ? ` · ${typicalMin} min` : ""}` : null;
  const expired = agenda.attention.find((a) => a.kind === "account");
  const quietNote = expired ? `${expired.title.replace(" sign-in expired", "")} is quiet because its sign-in expired.` : null;
  const eyebrow = `${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz })} · ${tz}`;
  const liveAt = now.toLocaleTimeString("en-GB", { timeZone: tz });

  return (
    <div className="flex flex-col gap-8">
      <TodayTopBar attention={agenda.attention} inbox={agenda.inbox} />
      <TodayHero eyebrow={eyebrow} greeting={`${greeting(tz)}, ${firstName}.`} lead={sum.lead} rest={sum.rest} health={council.state} healthText={council.text} />

      {forbidden && (
        <p className="rounded-lg bg-warn-soft px-4 py-3 text-[14px] text-warn">That page is not available to your role. Ask someone who owns this workspace.</p>
      )}

      <ViewOnly mode="detailed">
        <KpiStrip tiles={kpis} />
      </ViewOnly>

      <div id="compose" className="scroll-mt-6">
        {canCreate ? (
          <ComposerBar
            placement="top"
            accounts={accounts as ComposerBarAccount[]}
            skills={customSkills}
            plugins={plugins.map((p) => ({ slug: p.slug, name: p.name, kind: p.kind }))}
            models={composerModels}
            ideas={ideas}
            estimate={estimate}
          />
        ) : (
          <p className="rounded-[14px] border border-border bg-card px-5 py-4 text-[14px] text-muted-foreground">Your role can read posts but not write them.</p>
        )}
      </div>

      <NextSteps steps={steps.slice(0, 4)} />
      <NextSevenDays week={agenda.week} timeZone={tz} canCreate={canCreate} />

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1_1_600px] flex-col gap-8">
          {waiting.length > 0 && (
            <section id="waiting" aria-labelledby="waiting-h" className="flex scroll-mt-6 flex-col gap-3">
              <SectionHead
                id="waiting-h"
                title="Waiting on you"
                href="/posts?filter=review"
                linkLabel={agenda.awaitingCount > waiting.length ? `All ${agenda.awaitingCount} in review` : "All posts in review"}
                action={decidable.length > 1 ? <ApproveAllButton items={decidable} /> : null}
              />
              <AlsoWaiting items={waiting} timeZone={tz} canDecide={decidable.map((d) => d.runId)} canReview={canViewRuns} />
            </section>
          )}

          {live && canViewRuns && (
            <WritingNowCard
              runId={live.id}
              topic={live.topic}
              initial={toRunInitial(live)}
              platformsText={joinAnd([...new Set(live.platforms.map(platformName))])}
              assurance={live.assurance}
              canManage={canManage}
              typicalMs={typicalMs}
              queued={writing.length - 1}
            />
          )}

          {latest && (
            <ViewOnly mode="detailed">
              <WritingNowCard
                recent
                runId={latest.id}
                topic={latest.topic}
                initial={toRunInitial(latest)}
                platformsText={joinAnd([...new Set(latest.platforms.map(platformName))])}
                assurance={latest.assurance}
                canManage={canManage}
                typicalMs={typicalMs}
                queued={0}
              />
            </ViewOnly>
          )}

          <HowItsGoing results={agenda.results} quietNote={quietNote} />
          <Learned learnings={agenda.learnings} />

          <ViewOnly mode="detailed">
            <ActivityLog entries={activity} timeZone={tz} />
          </ViewOnly>
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 lg:max-w-[340px]" aria-label="At a glance">
          <AttentionCard items={agenda.attention} canPublish={ctx.can("content:publish")} canManage={canManage} />
          {canSettings && (
            <ViewOnly mode="detailed">
              <div className="flex flex-col gap-4">
                <SystemStatusCard providers={providers} queues={queues} at={liveAt} />
                {budget && spend && <SpendCard spentCents={spentCents} budgetCents={budget.budgetCents} breakdown={spend} />}
              </div>
            </ViewOnly>
          )}
          <WhatsAppCard items={agenda.inbox} />
          <GoingOutSoon items={agenda.upcoming} awaiting={agenda.awaitingCount} timeZone={tz} />
          <PlanCard plan={agenda.plan} canStart={canCreate} timeZone={tz} />
          {canSettings && (
            <ViewOnly mode="simple">
              <SetupCard steps={agenda.setup} />
            </ViewOnly>
          )}
        </aside>
      </div>
    </div>
  );
}
