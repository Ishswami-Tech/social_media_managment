/**
 * Account Brain learning (docs/agent-council.md "Learning").
 *
 * 1. `extractPostFeatures` turns a published variant into structured features.
 * 2. `refreshFeatureMetrics` copies the latest analytics snapshot onto them.
 * 3. `learnAccountProfile` updates `AccountProfile.performance` with
 *    statistical gating (age, impressions, sample size, one standard error).
 * 4. `recordHumanEdit` turns approver edits/rejections into weighted preferences.
 *
 * Everything here is best-effort background work: it must never throw into a
 * request path, so callers wrap it and the maintenance task logs failures.
 */
import type { Prisma } from "@platform/database";
import { prisma } from "../db";
import { logger, errorInfo } from "../logger";
import {
  appendPreference,
  MIN_AGE_DAYS,
  MIN_IMPRESSIONS,
  MIN_SAMPLES,
  PREFERENCE_WEIGHTS,
  recencyWeight,
  shouldUpdateBaseline,
  summarizeEdit,
  weightedAverage,
  type Preference,
  type WeightedSample,
} from "./learning-math";

const DAY_MS = 24 * 60 * 60_000;
const URL_RE = /https?:\/\/\S+/i;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;

// ---------------------------------------------------------------------------
// Feature heuristics (deterministic, no model)
// ---------------------------------------------------------------------------

export type HookType = "question" | "number" | "story" | "statement";
export type FormatType = "list" | "story" | "how-to" | "announcement" | "insight";
export type CtaType = "question" | "link" | "comment" | "none";

const STORY_RE = /\b(i remember|last (week|month|year)|when i|years? ago|my (first|story|journey)|once upon)\b/i;

export function detectHookType(text: string): HookType {
  const firstLine = text.split(/\n+/)[0]?.trim() ?? "";
  if (firstLine.endsWith("?") || /^\s*(what|why|how|who|when|where|did|do|have|is|are|can)\b/i.test(firstLine))
    return "question";
  if (/^\s*\d|\b\d+(\.\d+)?%|\b\d{2,}\b/.test(firstLine.slice(0, 80))) return "number";
  if (STORY_RE.test(firstLine)) return "story";
  return "statement";
}

export function detectFormat(text: string): FormatType {
  const lines = text.split(/\n/).map((l) => l.trim());
  const bulletLines = lines.filter((l) => /^([-•*▪]|\d+[.)])\s+/.test(l)).length;
  if (bulletLines >= 3) return "list";
  if (/\b(how to|step[- ]by[- ]step|steps?:|here'?s how)\b/i.test(text)) return "how-to";
  if (/\b(announcing|introducing|we'?re (excited|thrilled|proud)|just launched|launching|now available)\b/i.test(text))
    return "announcement";
  if (STORY_RE.test(text)) return "story";
  return "insight";
}

export function detectCtaType(text: string): CtaType {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^(#\S+\s*)+$/.test(l));
  const last = lines[lines.length - 1] ?? "";
  if (last.endsWith("?")) return "question";
  if (URL_RE.test(last) || URL_RE.test(lines[lines.length - 2] ?? "")) return "link";
  if (/\b(comment|let me know|share your|drop your|thoughts\b|tag (a|someone)|dm me)\b/i.test(last)) return "comment";
  if (URL_RE.test(text)) return "link";
  return "none";
}

export function countHashtags(text: string): number {
  return (text.match(HASHTAG_RE) ?? []).length;
}

// ---------------------------------------------------------------------------
// 1. Feature extraction
// ---------------------------------------------------------------------------

/** Upsert `PostFeatures` for one published variant. Returns the row id or null when not published. */
export async function extractPostFeatures(postVariantId: string): Promise<string | null> {
  const variant = await prisma.postVariant.findUnique({
    where: { id: postVariantId },
    include: {
      post: { select: { organizationId: true, title: true } },
      _count: { select: { media: true } },
    },
  });
  if (!variant || variant.status !== "PUBLISHED") return null;
  const publishedAt = variant.publishedAt ?? null;
  const data = {
    organizationId: variant.post.organizationId,
    socialAccountId: variant.socialAccountId,
    hookType: detectHookType(variant.text),
    format: detectFormat(variant.text),
    ctaType: detectCtaType(variant.text),
    topic: variant.post.title?.slice(0, 120) ?? null,
    length: variant.text.length,
    hashtagCount: countHashtags(variant.text),
    hasMedia: variant._count.media > 0,
    postedHourUtc: publishedAt ? publishedAt.getUTCHours() : null,
    postedWeekday: publishedAt ? publishedAt.getUTCDay() : null,
    publishedAt,
  };
  const row = await prisma.postFeatures.upsert({
    where: { postVariantId },
    create: { postVariantId, ...data },
    update: data,
  });
  return row.id;
}

/** Extract features for every published variant of the organization that has none yet (last 180 days). */
export async function extractMissingFeatures(organizationId: string): Promise<number> {
  const since = new Date(Date.now() - 180 * DAY_MS);
  const variants = await prisma.postVariant.findMany({
    where: {
      status: "PUBLISHED",
      publishedAt: { gte: since },
      post: { organizationId },
      features: null,
    },
    select: { id: true },
    take: 500,
  });
  let n = 0;
  for (const v of variants) {
    if (await extractPostFeatures(v.id)) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 2. Metrics refresh
// ---------------------------------------------------------------------------

function metricNumber(metrics: unknown, key: string): number {
  const m = (metrics ?? {}) as Record<string, unknown>;
  const v = Number(m[key] ?? 0);
  return Number.isFinite(v) ? v : 0;
}

/** Pull the latest POST-scope AnalyticsSnapshot into each PostFeatures row of the organization. */
export async function refreshFeatureMetrics(organizationId: string): Promise<number> {
  const features = await prisma.postFeatures.findMany({
    where: { organizationId },
    select: { id: true, postVariantId: true, capturedAt: true },
  });
  if (features.length === 0) return 0;
  const snapshots = await prisma.analyticsSnapshot.findMany({
    where: { organizationId, scope: "POST", postVariantId: { in: features.map((f) => f.postVariantId) } },
    orderBy: { capturedAt: "desc" },
    select: { postVariantId: true, capturedAt: true, metrics: true },
  });
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (s.postVariantId && !latest.has(s.postVariantId)) latest.set(s.postVariantId, s);
  }
  let n = 0;
  for (const f of features) {
    const snap = latest.get(f.postVariantId);
    if (!snap) continue;
    if (f.capturedAt && f.capturedAt.getTime() >= snap.capturedAt.getTime()) continue;
    const impressions = metricNumber(snap.metrics, "impressions") || metricNumber(snap.metrics, "reach");
    const engagements =
      metricNumber(snap.metrics, "engagements") ||
      metricNumber(snap.metrics, "likes") +
        metricNumber(snap.metrics, "comments") +
        metricNumber(snap.metrics, "shares") +
        metricNumber(snap.metrics, "clicks");
    await prisma.postFeatures.update({
      where: { id: f.id },
      data: {
        impressions: Math.round(impressions),
        engagements: Math.round(engagements),
        engagementRate: impressions > 0 ? engagements / impressions : null,
        capturedAt: snap.capturedAt,
      },
    });
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 3. Account profile learning
// ---------------------------------------------------------------------------

interface LearnedPerformance {
  sampleSize: number;
  confidence: number;
  baselineEngagementRate: number;
  bestHooks: string[];
  bestTopics: string[];
  bestFormats: string[];
  bestCtas: string[];
  bestPostingWindows: string[];
  updatedAt: string;
}

interface FeatureSample extends WeightedSample {
  hookType: string | null;
  format: string | null;
  ctaType: string | null;
  topic: string | null;
  window: string | null;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function postingWindow(hour: number | null, weekday: number | null): string | null {
  if (hour === null) return null;
  const bucket = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const day = weekday === null ? "" : `${WEEKDAYS[weekday] ?? "?"} `;
  return `${day}${bucket} (UTC)`;
}

/** Group samples by a feature and keep the values that clear the one-standard-error gate. */
function winners(samples: readonly FeatureSample[], pick: (s: FeatureSample) => string | null, baseline: number) {
  const groups = new Map<string, FeatureSample[]>();
  for (const s of samples) {
    const key = pick(s);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()]
    .filter(([, g]) => shouldUpdateBaseline(g, baseline))
    .sort((a, b) => weightedAverage(b[1]) - weightedAverage(a[1]))
    .map(([key]) => key)
    .slice(0, 5);
}

/**
 * Recompute `AccountProfile.performance` for one account. Returns what changed
 * (or why nothing did) so the maintenance log is informative.
 */
export async function learnAccountProfile(
  socialAccountId: string,
): Promise<{ updated: boolean; reason: string; sampleSize: number }> {
  const account = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: { id: true, organizationId: true, profile: { select: { id: true, performance: true } } },
  });
  if (!account) return { updated: false, reason: "account not found", sampleSize: 0 };
  const cutoff = new Date(Date.now() - MIN_AGE_DAYS * DAY_MS);
  const rows = await prisma.postFeatures.findMany({
    where: {
      socialAccountId,
      organizationId: account.organizationId,
      publishedAt: { lte: cutoff },
      impressions: { gt: 0 },
      engagementRate: { not: null },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
  });
  const totalImpressions = rows.reduce((acc, r) => acc + (r.impressions ?? 0), 0);
  if (rows.length < MIN_SAMPLES) return { updated: false, reason: "not enough samples", sampleSize: rows.length };
  if (totalImpressions < MIN_IMPRESSIONS)
    return { updated: false, reason: "not enough impressions", sampleSize: rows.length };

  const now = Date.now();
  const samples: FeatureSample[] = rows.map((r) => ({
    value: r.engagementRate ?? 0,
    weight: recencyWeight((now - (r.publishedAt?.getTime() ?? now)) / DAY_MS),
    hookType: r.hookType,
    format: r.format,
    ctaType: r.ctaType,
    topic: r.topic,
    window: postingWindow(r.postedHourUtc, r.postedWeekday),
  }));
  const baseline = weightedAverage(samples);
  const learned: LearnedPerformance = {
    sampleSize: rows.length,
    confidence: Number(Math.min(1, rows.length / 30).toFixed(2)),
    baselineEngagementRate: Number(baseline.toFixed(5)),
    bestHooks: winners(samples, (s) => s.hookType, baseline),
    bestFormats: winners(samples, (s) => s.format, baseline),
    bestCtas: winners(samples, (s) => s.ctaType, baseline),
    bestTopics: winners(samples, (s) => s.topic, baseline),
    bestPostingWindows: winners(samples, (s) => s.window, baseline),
    updatedAt: new Date().toISOString(),
  };
  const anySignal =
    learned.bestHooks.length +
      learned.bestFormats.length +
      learned.bestCtas.length +
      learned.bestTopics.length +
      learned.bestPostingWindows.length >
    0;
  if (!anySignal && !account.profile?.performance)
    return { updated: false, reason: "no feature beat the baseline by one standard error", sampleSize: rows.length };

  // Keep previously learned "best" lists when the new pass found no significant
  // winner for that dimension: the gate protects against noise, not against forgetting.
  const previous = (account.profile?.performance ?? {}) as Partial<LearnedPerformance>;
  const merged: LearnedPerformance = {
    ...learned,
    bestHooks: learned.bestHooks.length ? learned.bestHooks : (previous.bestHooks ?? []),
    bestFormats: learned.bestFormats.length ? learned.bestFormats : (previous.bestFormats ?? []),
    bestCtas: learned.bestCtas.length ? learned.bestCtas : (previous.bestCtas ?? []),
    bestTopics: learned.bestTopics.length ? learned.bestTopics : (previous.bestTopics ?? []),
    bestPostingWindows: learned.bestPostingWindows.length
      ? learned.bestPostingWindows
      : (previous.bestPostingWindows ?? []),
  };
  const performance = merged as unknown as Prisma.InputJsonValue;
  await prisma.accountProfile.upsert({
    where: { socialAccountId },
    create: {
      organizationId: account.organizationId,
      socialAccountId,
      performance,
      sampleSize: rows.length,
      learnedAt: new Date(),
    },
    update: { performance, sampleSize: rows.length, learnedAt: new Date() },
  });
  await prisma.postFeatures.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { learnedAt: new Date() } });
  return { updated: true, reason: anySignal ? "features updated" : "baseline refreshed", sampleSize: rows.length };
}

// ---------------------------------------------------------------------------
// 4. Human feedback
// ---------------------------------------------------------------------------

export interface HumanEditInput {
  before: string;
  after: string;
  comment?: string;
  source: Preference["source"];
}

/**
 * Turn an approver's edit (or a rejection/approval comment) into a weighted
 * preference on the account's `humanFeedback.preferences`. Older entries decay
 * and the list is capped (see learning-math).
 */
export async function recordHumanEdit(socialAccountId: string, input: HumanEditInput): Promise<void> {
  const changed = input.before.trim() !== input.after.trim();
  const diff = changed ? summarizeEdit(input.before, input.after) : "";
  const text = [input.comment?.trim(), diff].filter((s): s is string => Boolean(s)).join(" — ");
  if (!text) return;
  const account = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: { organizationId: true, profile: { select: { humanFeedback: true } } },
  });
  if (!account) return;
  const existing = readPreferences(account.profile?.humanFeedback);
  const next: Preference = {
    text: text.slice(0, 400),
    weight: PREFERENCE_WEIGHTS[input.source],
    source: input.source,
    at: new Date().toISOString(),
  };
  const humanFeedback = { preferences: appendPreference(existing, next) } as unknown as Prisma.InputJsonValue;
  await prisma.accountProfile.upsert({
    where: { socialAccountId },
    create: { organizationId: account.organizationId, socialAccountId, humanFeedback },
    update: { humanFeedback },
  });
}

function readPreferences(json: unknown): Preference[] {
  const raw = (json as { preferences?: unknown } | null)?.preferences;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is Preference =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as Preference).text === "string" &&
      typeof (p as Preference).weight === "number",
  );
}

// ---------------------------------------------------------------------------
// Maintenance entry point
// ---------------------------------------------------------------------------

/** Daily task: extract → refresh → learn for every organization. Never throws. */
export async function learnAllAccountProfiles(): Promise<{ organizations: number; accountsUpdated: number }> {
  const orgs = await prisma.organization.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let accountsUpdated = 0;
  for (const org of orgs) {
    try {
      await extractMissingFeatures(org.id);
      await refreshFeatureMetrics(org.id);
      const accounts = await prisma.socialAccount.findMany({
        where: { organizationId: org.id },
        select: { id: true },
      });
      for (const a of accounts) {
        const result = await learnAccountProfile(a.id);
        if (result.updated) accountsUpdated += 1;
      }
    } catch (e) {
      logger.warn("account profile learning failed", { organizationId: org.id, ...errorInfo(e) });
    }
  }
  return { organizations: orgs.length, accountsUpdated };
}
