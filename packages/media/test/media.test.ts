import { describe, expect, it } from "vitest";
import { MemoryStorage, buildStorageKey, checksum, pickRendition, sniffMime, validateUpload } from "../src/index";

describe("validateUpload", () => {
  it("accepts known types under the size limit", () => {
    expect(validateUpload({ fileName: "a.png", mimeType: "image/png", size: 1000 })).toEqual({
      ok: true,
      kind: "IMAGE",
    });
    expect(validateUpload({ fileName: "clip.mp4", mimeType: "video/mp4", size: 5_000_000 }).ok).toBe(true);
  });
  it("rejects unknown types, oversize files, bad names and mismatched extensions", () => {
    expect(validateUpload({ fileName: "x.exe", mimeType: "application/octet-stream", size: 1 }).ok).toBe(false);
    expect(validateUpload({ fileName: "a.png", mimeType: "image/png", size: 31 * 1024 * 1024 }).error).toMatch(/30MB/);
    expect(validateUpload({ fileName: "../a.png", mimeType: "image/png", size: 1 }).ok).toBe(false);
    expect(validateUpload({ fileName: "a.jpg", mimeType: "image/png", size: 1 }).error).toMatch(/extension/);
  });
});

describe("sniffMime", () => {
  it("detects magic bytes", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeUndefined();
  });
});

describe("keys & renditions", () => {
  it("builds tenant-prefixed keys and ignores path tricks", () => {
    expect(buildStorageKey("org1", "asset1", "../../evil.PNG")).toBe("org/org1/media/asset1.png");
    expect(buildStorageKey("org1", "asset1", "noext")).toBe("org/org1/media/asset1.noext");
  });
  it("chooses Instagram portrait for tall images", () => {
    expect(pickRendition("INSTAGRAM", 1000, 1500).name).toBe("instagram_portrait");
    expect(pickRendition("INSTAGRAM", 1000, 1000).name).toBe("instagram_square");
    expect(pickRendition("LINKEDIN", 1, 1).name).toBe("linkedin_feed");
  });
  it("checksums are stable", () => {
    expect(checksum(Buffer.from("abc"))).toBe(checksum(Buffer.from("abc")));
  });
  it("memory storage round-trips", async () => {
    const s = new MemoryStorage();
    await s.putObject("k", Buffer.from("hi"), "text/plain");
    expect((await s.getObject("k")).toString()).toBe("hi");
    expect(await s.head("k")).toEqual({ size: 2, mimeType: "text/plain" });
    expect(await s.head("nope")).toBeNull();
  });
});

describe("DiskStorage", () => {
  it("round-trips objects on disk with mime metadata", async () => {
    const { DiskStorage } = await import("../src/storage");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(`${tmpdir()}/media-`);
    const s = new DiskStorage(dir, "http://localhost/api/media/dev");
    await s.putObject("org/a/media/x.png", Buffer.from("png"), "image/png");
    expect((await s.getObject("org/a/media/x.png")).toString()).toBe("png");
    expect(await s.head("org/a/media/x.png")).toEqual({ size: 3, mimeType: "image/png" });
    expect(await s.head("nope")).toBeNull();
    expect(await s.signedUploadUrl("k")).toContain("key=k");
    await s.delete("org/a/media/x.png");
    expect(await s.head("org/a/media/x.png")).toBeNull();
  });
});
