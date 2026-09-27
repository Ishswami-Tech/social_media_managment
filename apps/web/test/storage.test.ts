import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@platform/config";
import { DiskStorage, R2Storage, S3Storage } from "@platform/media";

vi.mock("../lib/env", () => ({ getEnv: vi.fn() }));
import { getEnv } from "../lib/env";
import { storage } from "../lib/storage";

const base = {
  NODE_ENV: "test" as const,
  DATABASE_URL: "postgresql://test",
  AUTH_SECRET: "test-secret-0123456789",
  ENCRYPTION_KEY: "0".repeat(64),
};

afterEach(() => {
  globalThis.__platformStorage = undefined;
  vi.clearAllMocks();
});

describe("storage selection", () => {
  it("uses Contabo for web and worker media even with legacy R2 settings present", async () => {
    vi.mocked(getEnv).mockReturnValue(
      loadEnv({
        ...base,
        S3_ENDPOINT: "https://sin1.contabostorage.com",
        S3_REGION: "default",
        S3_ACCESS_KEY_ID: "test",
        S3_SECRET_ACCESS_KEY: "test",
        S3_BUCKET: "media",
        R2_ACCOUNT_ID: "old",
        R2_ACCESS_KEY_ID: "old",
        R2_SECRET_ACCESS_KEY: "old",
        R2_BUCKET: "old",
      }),
    );
    const selected = storage();
    expect(selected).toBeInstanceOf(S3Storage);
    expect(selected.kind).toBe("s3");
    expect(new URL(await selected.signedDownloadUrl("image.png")).host).toBe("sin1.contabostorage.com");
    expect(storage()).toBe(selected);
  });

  it("preserves existing R2 configuration", () => {
    vi.mocked(getEnv).mockReturnValue(
      loadEnv({
        ...base,
        R2_ACCOUNT_ID: "old",
        R2_ACCESS_KEY_ID: "old",
        R2_SECRET_ACCESS_KEY: "old",
        R2_BUCKET: "old",
      }),
    );
    expect(storage()).toBeInstanceOf(R2Storage);
    expect(storage().kind).toBe("r2");
  });

  it("uses local storage when object storage is unconfigured", () => {
    vi.mocked(getEnv).mockReturnValue(loadEnv(base));
    expect(storage()).toBeInstanceOf(DiskStorage);
  });
});
