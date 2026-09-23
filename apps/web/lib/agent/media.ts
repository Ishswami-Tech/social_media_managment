/**
 * Images for Agent Council recommendations.
 *
 * ADAPTING leaves every account with a written media concept. When the person
 * asked for an image (or the platform cannot post without one) the worker turns
 * that concept into a real picture here, stores it as an organization media
 * asset and attaches it to the recommendation, so approval publishes text and
 * image together through the ordinary Post → PublishJob path.
 *
 * The planning helpers are pure so they can be unit-tested; only
 * `generateRunMedia` touches providers and the database.
 */
import type { Platform } from "@platform/types";
import { aiRuntime } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { errorInfo, logger } from "@/lib/logger";
import { mediaUrl, storeGeneratedImageFor } from "@/lib/services/media";

/** Platforms that reject a post without media, so an image is made even when nobody asked. */
const IMAGE_REQUIRED_PLATFORMS: ReadonlySet<string> = new Set<Platform>(["INSTAGRAM", "PINTEREST"]);

/** Landscape for feeds that show wide cards, square where the feed is square. */
const SQUARE_PLATFORMS: ReadonlySet<string> = new Set<Platform>(["INSTAGRAM", "PINTEREST"]);
const MAX_CONCEPT_CHARS = 1_500;
const MAX_ERROR_CHARS = 300;

export type ImageSize = "1024x1024" | "1536x1024";

export interface MediaCandidate {
  runAccountId: string;
  platform: string;
  mediaConcept: string | null;
  mediaAssetIds: readonly string[];
}

export interface MediaPlanItem {
  runAccountId: string;
  platform: string;
  prompt: string;
  size: ImageSize;
}

export function imageSizeFor(platform: string): ImageSize {
  return SQUARE_PLATFORMS.has(platform) ? "1024x1024" : "1536x1024";
}

/** The concept the adapt stage wrote, framed as a generation prompt for the platform. */
export function imagePromptFor(topic: string, platform: string, concept: string): string {
  const trimmed = concept.trim().slice(0, MAX_CONCEPT_CHARS);
  return [
    `Create a single social media image for a ${platform.toLowerCase()} post about: ${topic.trim()}.`,
    `Visual brief: ${trimmed}`,
    "Requirements: one polished image, professional and on-brand, no watermarks, no logos of other companies, and no text unless the brief asks for specific words.",
  ].join("\n");
}

/**
 * Which accounts get an image: those without one that either asked for it or
 * cannot publish without it, and that have a concept to draw from.
 */
export function planRunMedia(
  run: { topic: string; wantsImage: boolean },
  accounts: readonly MediaCandidate[],
): MediaPlanItem[] {
  return accounts.flatMap((a) => {
    if (a.mediaAssetIds.length > 0) return [];
    if (!run.wantsImage && !IMAGE_REQUIRED_PLATFORMS.has(a.platform)) return [];
    const concept = a.mediaConcept?.trim();
    if (!concept) return [];
    return [{ runAccountId: a.runAccountId, platform: a.platform, prompt: imagePromptFor(run.topic, a.platform, concept), size: imageSizeFor(a.platform) }];
  });
}

export interface RecommendationImage {
  url: string;
  alt: string;
}

/**
 * Thumbnail links for the media attached to recommendations, keyed by asset id.
 * Only the organization's own assets are returned; ids from anywhere else are ignored.
 */
export async function loadRecommendationImages(
  organizationId: string,
  assetIds: readonly string[],
): Promise<Map<string, RecommendationImage>> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return new Map();
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: ids }, organizationId, status: { in: ["UPLOADED", "PROCESSING", "READY"] } },
    select: { id: true, storageKey: true, variants: true, aiPrompt: true, fileName: true },
  });
  const entries = await Promise.all(
    assets.map(async (a) => [a.id, { url: await mediaUrl(a, "thumbnail"), alt: a.aiPrompt?.slice(0, 200) ?? a.fileName }] as const),
  );
  return new Map(entries);
}

async function recordEvent(runId: string, runAccountId: string, status: "STARTED" | "SUCCEEDED" | "FAILED", extra: Record<string, unknown> = {}): Promise<void> {
  await prisma.agentRunEvent.create({ data: { runId, step: `media:${runAccountId}`, status, ...extra } });
}

async function fetchBytes(image: { base64?: string; url?: string }): Promise<Buffer> {
  if (image.base64) return Buffer.from(image.base64, "base64");
  if (!image.url) throw new Error("The image provider returned neither data nor a URL");
  const res = await fetch(image.url);
  if (!res.ok) throw new Error(`Could not download the generated image (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Generates and attaches the planned images. One failure never fails the run:
 * the account keeps its written concept and the event trail says why.
 * Accounts sharing an identical prompt share one asset.
 */
export async function generateRunMedia(runId: string, organizationId: string): Promise<{ generated: number; failed: number }> {
  const run = await prisma.agentRun.findFirst({
    where: { id: runId, organizationId },
    select: {
      topic: true,
      wantsImage: true,
      createdById: true,
      accounts: { select: { id: true, platform: true, mediaConcept: true, mediaAssetIds: true } },
    },
  });
  if (!run) return { generated: 0, failed: 0 };
  const plan = planRunMedia(run, run.accounts.map((a) => ({ runAccountId: a.id, platform: a.platform, mediaConcept: a.mediaConcept, mediaAssetIds: a.mediaAssetIds })));
  if (plan.length === 0) return { generated: 0, failed: 0 };

  const log = logger.child({ worker: "agent-run", runId, organizationId });
  const ai = await aiRuntime(organizationId, run.createdById);
  const byPrompt = new Map<string, string>();
  let generated = 0;
  let failed = 0;
  for (const item of plan) {
    const started = Date.now();
    await recordEvent(runId, item.runAccountId, "STARTED", { input: item.prompt });
    try {
      let assetId = byPrompt.get(item.prompt);
      let provider: string | undefined;
      let model: string | undefined;
      if (!assetId) {
        const res = await ai.image({ prompt: item.prompt, size: item.size, n: 1 });
        const image = res.images[0];
        if (!image) throw new Error("The image provider returned no image");
        const asset = await storeGeneratedImageFor({ organizationId, userId: run.createdById }, await fetchBytes(image), image.mimeType, item.prompt);
        assetId = asset.id;
        provider = res.provider;
        model = res.model;
        byPrompt.set(item.prompt, assetId);
      }
      await prisma.agentRunAccount.update({ where: { id: item.runAccountId }, data: { mediaAssetIds: [assetId] } });
      await recordEvent(runId, item.runAccountId, "SUCCEEDED", { provider, model, latencyMs: Date.now() - started, output: { mediaAssetId: assetId } });
      generated += 1;
    } catch (error) {
      failed += 1;
      const { message } = errorInfo(error);
      log.warn("could not generate an image for a recommendation", { runAccountId: item.runAccountId, ...errorInfo(error) });
      await recordEvent(runId, item.runAccountId, "FAILED", { error: message.slice(0, MAX_ERROR_CHARS), latencyMs: Date.now() - started });
    }
  }
  return { generated, failed };
}
