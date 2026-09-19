import { createHash } from "node:crypto";
import type { Platform } from "@platform/types";

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  size: number;
}

export interface RenditionSpec {
  name: string;
  width: number;
  height?: number;
  fit: "cover" | "inside";
  format: "jpeg" | "png" | "webp";
  quality?: number;
}

/**
 * Platform-specific renditions (spec §19). Instagram needs JPEG within
 * 4:5 .. 1.91:1; LinkedIn/Facebook accept most sizes but benefit from 1200px.
 */
export const RENDITIONS: Record<Platform, RenditionSpec[]> = {
  INSTAGRAM: [
    { name: "instagram_square", width: 1080, height: 1080, fit: "cover", format: "jpeg", quality: 90 },
    { name: "instagram_portrait", width: 1080, height: 1350, fit: "cover", format: "jpeg", quality: 90 },
  ],
  FACEBOOK: [{ name: "facebook_feed", width: 1200, fit: "inside", format: "jpeg", quality: 88 }],
  LINKEDIN: [{ name: "linkedin_feed", width: 1200, fit: "inside", format: "jpeg", quality: 88 }],
  X: [{ name: "x_feed", width: 1600, fit: "inside", format: "jpeg", quality: 85 }],
  TIKTOK: [{ name: "tiktok_photo", width: 1080, height: 1920, fit: "cover", format: "jpeg", quality: 90 }],
  YOUTUBE: [{ name: "youtube_thumb", width: 1280, height: 720, fit: "cover", format: "jpeg", quality: 90 }],
  THREADS: [{ name: "threads_feed", width: 1080, fit: "inside", format: "jpeg", quality: 88 }],
  PINTEREST: [{ name: "pinterest_pin", width: 1000, height: 1500, fit: "cover", format: "jpeg", quality: 90 }],
};

export const THUMBNAIL: RenditionSpec = { name: "thumbnail", width: 400, fit: "inside", format: "webp", quality: 75 };

export function checksum(buf: Uint8Array | Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Lazy import keeps sharp (native) out of the request path and out of edge bundles. */
async function loadSharp() {
  const mod = await import("sharp");
  return mod.default;
}

export async function inspectImage(buf: Buffer): Promise<ImageInfo> {
  const sharp = await loadSharp();
  const meta = await sharp(buf).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0, format: meta.format ?? "unknown", size: buf.length };
}

/** Strips EXIF/GPS metadata, auto-rotates, and produces the requested rendition. */
export async function renderRendition(buf: Buffer, spec: RenditionSpec): Promise<Buffer> {
  const sharp = await loadSharp();
  let pipeline = sharp(buf)
    .rotate()
    .resize({ width: spec.width, height: spec.height, fit: spec.fit, withoutEnlargement: spec.fit === "inside" });
  if (spec.format === "jpeg") pipeline = pipeline.jpeg({ quality: spec.quality ?? 85, mozjpeg: true });
  else if (spec.format === "webp") pipeline = pipeline.webp({ quality: spec.quality ?? 80 });
  else pipeline = pipeline.png();
  return pipeline.toBuffer();
}

export function pickRendition(platform: Platform, width: number, height: number): RenditionSpec {
  const specs = RENDITIONS[platform];
  if (platform === "INSTAGRAM") return width / height < 0.95 ? specs[1]! : specs[0]!;
  return specs[0]!;
}
