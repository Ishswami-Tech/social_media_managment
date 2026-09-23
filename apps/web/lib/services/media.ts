import { z } from "zod";
import {
  buildStorageKey,
  checksum,
  inspectImage,
  pickRendition,
  renderRendition,
  THUMBNAIL,
  validateUpload,
} from "@platform/media";
import { PLATFORMS } from "@platform/types";
import { badRequest, notFound } from "../errors";
import { audit } from "../audit";
import { prisma } from "../db";
import { logger, errorInfo } from "../logger";
import { queues } from "../queue";
import type { OrgContext } from "../session";
import { storage } from "../storage";

export const requestUploadInput = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(100),
  size: z.number().int().positive(),
  altText: z.string().max(500).optional(),
});

/** Step 1: validate, create a PENDING_UPLOAD asset and hand back a signed PUT URL. */
export async function requestUpload(ctx: OrgContext, input: z.infer<typeof requestUploadInput>) {
  const v = validateUpload(input);
  if (!v.ok || !v.kind) throw badRequest(v.error ?? "Invalid upload");
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: ctx.organization.id,
      uploadedById: ctx.user.id,
      kind: v.kind,
      storageKey: `pending/${crypto.randomUUID()}`,
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.size,
      altText: input.altText,
    },
  });
  const storageKey = buildStorageKey(ctx.organization.id, asset.id, input.fileName);
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey } });
  const uploadUrl = await storage().signedUploadUrl(storageKey, input.mimeType);
  return { assetId: asset.id, uploadUrl, storageKey };
}

/** Step 2: the browser finished the PUT; verify the object exists and queue processing. */
export async function completeUpload(ctx: OrgContext, assetId: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, organizationId: ctx.organization.id } });
  if (!asset) throw notFound("Media asset");
  const head = await storage().head(asset.storageKey);
  if (!head) throw badRequest("Upload not found in storage yet");
  await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { status: "UPLOADED", size: head.size || asset.size },
  });
  await queues().enqueue("media", `media:${asset.id}`, { mediaAssetId: asset.id, organizationId: ctx.organization.id });
  await audit(ctx, "media.upload", "MediaAsset", asset.id, { fileName: asset.fileName, size: head.size });
  return prisma.mediaAsset.findUnique({ where: { id: asset.id } });
}

/** Store bytes generated server-side (AI images) directly. */
export async function storeGeneratedImage(ctx: OrgContext, bytes: Buffer, mimeType: string, prompt: string) {
  return storeGeneratedImageFor({ organizationId: ctx.organization.id, userId: ctx.user.id }, bytes, mimeType, prompt);
}

/** Same as `storeGeneratedImage` for callers without a session (the agent worker acts as the run's creator). */
export async function storeGeneratedImageFor(
  owner: { organizationId: string; userId: string },
  bytes: Buffer,
  mimeType: string,
  prompt: string,
) {
  const sum = checksum(bytes);
  const existing = await prisma.mediaAsset.findFirst({ where: { organizationId: owner.organizationId, checksum: sum } });
  if (existing) return existing;
  const ext = mimeType === "image/jpeg" ? "jpg" : "png";
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: owner.organizationId,
      uploadedById: owner.userId,
      kind: "IMAGE",
      storageKey: `pending/${crypto.randomUUID()}`,
      fileName: `ai-${Date.now()}.${ext}`,
      mimeType,
      size: bytes.length,
      status: "UPLOADED",
      source: "AI_GENERATED",
      aiPrompt: prompt,
      checksum: sum,
    },
  });
  const storageKey = buildStorageKey(owner.organizationId, asset.id, asset.fileName);
  await storage().putObject(storageKey, bytes, mimeType);
  const updated = await prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey } });
  await queues().enqueue("media", `media:${asset.id}`, { mediaAssetId: asset.id, organizationId: owner.organizationId });
  return updated;
}

/** Worker: compute checksum/dimensions, strip metadata, generate thumbnail + platform renditions. */
export async function processMedia(mediaAssetId: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
  if (!asset || asset.status === "READY") return;
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "PROCESSING" } });
  try {
    const bytes = await storage().getObject(asset.storageKey);
    const sum = checksum(bytes);
    const data: Record<string, unknown> = { checksum: sum, size: bytes.length };
    if (asset.kind === "IMAGE") {
      const info = await inspectImage(bytes);
      data.width = info.width;
      data.height = info.height;
      const variants: Record<string, string> = {};
      const thumbKey = asset.storageKey.replace(/\.[^.]+$/, "") + ".thumb.webp";
      await storage().putObject(thumbKey, await renderRendition(bytes, THUMBNAIL), "image/webp");
      variants.thumbnail = thumbKey;
      for (const platform of PLATFORMS) {
        if (!["INSTAGRAM", "LINKEDIN", "FACEBOOK"].includes(platform)) continue;
        const spec = pickRendition(platform, info.width, info.height);
        const key = asset.storageKey.replace(/\.[^.]+$/, "") + `.${spec.name}.jpg`;
        await storage().putObject(key, await renderRendition(bytes, spec), "image/jpeg");
        variants[spec.name] = key;
      }
      data.variants = variants;
    }
    const duplicate = await prisma.mediaAsset.findFirst({
      where: { organizationId: asset.organizationId, checksum: sum, id: { not: asset.id } },
    });
    if (duplicate) logger.info("duplicate media detected", { mediaAssetId, duplicateOf: duplicate.id });
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { ...data, status: "READY", checksum: duplicate ? null : sum },
    });
  } catch (e) {
    logger.error("media processing failed", { mediaAssetId, ...errorInfo(e) });
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "FAILED" } });
    throw e;
  }
}

export async function mediaUrl(
  asset: { storageKey: string; variants: unknown },
  variant?: "thumbnail",
): Promise<string> {
  const variants = (asset.variants as Record<string, string> | null) ?? {};
  const key = (variant && variants[variant]) || asset.storageKey;
  return storage().publicUrl(key) ?? storage().signedDownloadUrl(key, 3600);
}
