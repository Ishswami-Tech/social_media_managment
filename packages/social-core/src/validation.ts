import type { PlatformCapabilities } from "@platform/types";
import type { NormalizedPost, ValidationIssue, ValidationResult } from "./types";

/**
 * Generic, capability-driven validation. Adapters call this first and then
 * add platform-specific checks (e.g. Instagram aspect ratios).
 */
export function validateAgainstCapabilities(post: NormalizedPost, caps: PlatformCapabilities): ValidationResult {
  const issues: ValidationIssue[] = [];
  const textLength = countGraphemes(post.text);

  if (textLength === 0 && post.media.length === 0) {
    issues.push({ code: "EMPTY_POST", message: "Post has no text and no media", severity: "error" });
  }
  if (textLength > caps.text.maxLength) {
    issues.push({
      code: "TEXT_TOO_LONG",
      field: "text",
      message: `Text is ${textLength} characters; maximum is ${caps.text.maxLength}`,
      severity: "error",
    });
  }
  if (caps.media.required && post.media.length === 0) {
    issues.push({
      code: "MEDIA_REQUIRED",
      field: "media",
      message: "This platform requires at least one media item",
      severity: "error",
    });
  }
  if (post.media.length > caps.media.maxCount) {
    issues.push({
      code: "TOO_MANY_MEDIA",
      field: "media",
      message: `${post.media.length} media items; maximum is ${caps.media.maxCount}`,
      severity: "error",
    });
  }
  if (post.media.length > 1 && !caps.supportsCarousel) {
    issues.push({
      code: "CAROUSEL_UNSUPPORTED",
      field: "media",
      message: "This platform does not support multiple media items in one post",
      severity: "error",
    });
  }
  const kinds = new Set(post.media.map((m) => m.kind));
  if (kinds.has("IMAGE") && kinds.has("VIDEO")) {
    issues.push({
      code: "MIXED_MEDIA",
      field: "media",
      message: "Images and videos cannot be mixed in one post",
      severity: "error",
    });
  }
  for (const m of post.media) {
    if (!caps.media.kinds.includes(m.kind)) {
      issues.push({
        code: "MEDIA_KIND_UNSUPPORTED",
        field: "media",
        message: `${m.kind} is not supported on this platform`,
        severity: "error",
      });
    }
    if (m.kind === "IMAGE" && caps.media.maxImageBytes && m.size > caps.media.maxImageBytes) {
      issues.push({
        code: "IMAGE_TOO_LARGE",
        field: "media",
        message: `Image ${m.id} exceeds ${Math.round(caps.media.maxImageBytes / 1_000_000)}MB`,
        severity: "error",
      });
    }
    if (m.kind === "VIDEO" && caps.media.maxVideoBytes && m.size > caps.media.maxVideoBytes) {
      issues.push({
        code: "VIDEO_TOO_LARGE",
        field: "media",
        message: `Video ${m.id} exceeds ${Math.round(caps.media.maxVideoBytes / 1_000_000)}MB`,
        severity: "error",
      });
    }
    if (m.kind === "VIDEO" && caps.media.maxVideoSeconds && m.duration && m.duration > caps.media.maxVideoSeconds) {
      issues.push({
        code: "VIDEO_TOO_LONG",
        field: "media",
        message: `Video ${m.id} exceeds ${caps.media.maxVideoSeconds}s`,
        severity: "error",
      });
    }
  }
  if (!caps.supportsHashtags && /#\w+/.test(post.text)) {
    issues.push({
      code: "HASHTAGS_IGNORED",
      field: "text",
      message: "Hashtags have no effect on this platform",
      severity: "warning",
    });
  }
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

export function countGraphemes(text: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let n = 0;
    for (const _ of seg.segment(text)) n++;
    return n;
  }
  return [...text].length;
}

export function mergeValidation(...results: ValidationResult[]): ValidationResult {
  const issues = results.flatMap((r) => r.issues);
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}
