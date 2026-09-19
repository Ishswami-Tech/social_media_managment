import { describe, expect, it } from "vitest";
import type { PlatformCapabilities } from "@platform/types";
import {
  ProviderError,
  ProviderRegistry,
  codeChallengeS256,
  isRetryable,
  needsRefresh,
  validateAgainstCapabilities,
} from "../src/index";

const caps: PlatformCapabilities = {
  text: { maxLength: 100 },
  media: { kinds: ["IMAGE", "VIDEO"], maxCount: 4, maxImageBytes: 1_000_000, required: false },
  supportsCarousel: true,
  supportsScheduling: false,
  supportsLinkPreview: true,
  supportsHashtags: true,
  supportsFirstComment: false,
};

const img = (id: string, size = 10) => ({
  id,
  kind: "IMAGE" as const,
  mimeType: "image/png",
  size,
  url: "https://x/y.png",
});

describe("validateAgainstCapabilities", () => {
  it("passes a simple valid post", () => {
    expect(validateAgainstCapabilities({ idempotencyKey: "k", text: "hi", media: [] }, caps).ok).toBe(true);
  });
  it("rejects empty posts", () => {
    const r = validateAgainstCapabilities({ idempotencyKey: "k", text: "", media: [] }, caps);
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe("EMPTY_POST");
  });
  it("counts graphemes, not UTF-16 units", () => {
    const text = "👨‍👩‍👧".repeat(50); // 50 graphemes, far more code units
    expect(validateAgainstCapabilities({ idempotencyKey: "k", text, media: [] }, caps).ok).toBe(true);
    expect(
      validateAgainstCapabilities({ idempotencyKey: "k", text: "a".repeat(101), media: [] }, caps).issues.map(
        (i) => i.code,
      ),
    ).toContain("TEXT_TOO_LONG");
  });
  it("enforces media rules", () => {
    const r = validateAgainstCapabilities(
      { idempotencyKey: "k", text: "x", media: [img("a", 2_000_000), { ...img("b"), kind: "VIDEO" }] },
      caps,
    );
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("IMAGE_TOO_LARGE");
    expect(codes).toContain("MIXED_MEDIA");
    expect(
      validateAgainstCapabilities(
        { idempotencyKey: "k", text: "x", media: [img("1"), img("2"), img("3"), img("4"), img("5")] },
        caps,
      ).issues.map((i) => i.code),
    ).toContain("TOO_MANY_MEDIA");
  });
  it("requires media when the platform demands it", () => {
    const r = validateAgainstCapabilities(
      { idempotencyKey: "k", text: "x", media: [] },
      { ...caps, media: { ...caps.media, required: true } },
    );
    expect(r.issues.map((i) => i.code)).toContain("MEDIA_REQUIRED");
  });
});

describe("ProviderError", () => {
  it("maps HTTP status to retryability", () => {
    expect(ProviderError.fromHttp(401, {}).retryable).toBe(false);
    expect(ProviderError.fromHttp(401, {}).code).toBe("AUTH_EXPIRED");
    expect(ProviderError.fromHttp(403, {}).code).toBe("PERMISSION_DENIED");
    expect(ProviderError.fromHttp(429, {}).retryable).toBe(true);
    expect(ProviderError.fromHttp(503, {}).retryable).toBe(true);
    expect(ProviderError.fromHttp(400, { error: { message: "bad" } }).message).toBe("bad");
    expect(ProviderError.fromHttp(400, {}).retryable).toBe(false);
  });
  it("isRetryable treats network TypeErrors as transient", () => {
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryable(new Error("boom"))).toBe(false);
  });
});

describe("oauth helpers", () => {
  it("computes S256 challenge", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("needsRefresh honours skew", () => {
    const now = Date.now();
    expect(needsRefresh(new Date(now + 60_000), 5 * 60_000, now)).toBe(true);
    expect(needsRefresh(new Date(now + 60 * 60_000), 5 * 60_000, now)).toBe(false);
    expect(needsRefresh(null)).toBe(false);
  });
});

describe("ProviderRegistry", () => {
  it("registers and resolves by platform and family", () => {
    const reg = new ProviderRegistry();
    const fake = { platform: "LINKEDIN", family: "LINKEDIN", capabilities: caps } as never;
    reg.register(fake);
    expect(reg.get("LINKEDIN")).toBe(fake);
    expect(reg.has("X")).toBe(false);
    expect(() => reg.get("X")).toThrow(/No provider/);
    expect(reg.byFamily("LINKEDIN")).toHaveLength(1);
  });
});
