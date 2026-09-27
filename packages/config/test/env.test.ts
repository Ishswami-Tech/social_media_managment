import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/index";

const base = {
  DATABASE_URL: "postgresql://x",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

describe("loadEnv", () => {
  it("parses a minimal valid environment with defaults", () => {
    const env = loadEnv({ ...base });
    expect(env.NODE_ENV).toBe("development");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("treats blank optional values as undefined", () => {
    const env = loadEnv({ ...base, LINKEDIN_CLIENT_ID: "   " });
    expect(env.LINKEDIN_CLIENT_ID).toBeUndefined();
  });

  it("lists every problem when configuration is invalid", () => {
    expect(() => loadEnv({ DATABASE_URL: "" })).toThrow(/AUTH_SECRET/);
    expect(() => loadEnv({ DATABASE_URL: "" })).toThrow(/ENCRYPTION_KEY/);
  });

  const s3 = {
    S3_ENDPOINT: "https://eu2.contabostorage.com",
    S3_REGION: "default",
    S3_ACCESS_KEY_ID: "test-access",
    S3_SECRET_ACCESS_KEY: "test-secret",
    S3_BUCKET: "media",
  };

  it("accepts Contabo configuration and blank optional public URLs", () => {
    const env = loadEnv({ ...base, ...s3, S3_PUBLIC_BASE_URL: " " });
    expect(env.S3_ENDPOINT).toBe(s3.S3_ENDPOINT);
    expect(env.S3_REGION).toBe("default");
    expect(env.S3_PUBLIC_BASE_URL).toBeUndefined();
  });

  it.each(Object.keys(s3))("rejects incomplete S3 configuration missing %s", (key) => {
    expect(() => loadEnv({ ...base, ...s3, [key]: "" })).toThrow(key);
  });

  it("rejects insecure endpoints and incomplete public storage configuration", () => {
    expect(() => loadEnv({ ...base, ...s3, S3_ENDPOINT: "http://eu2.contabostorage.com" })).toThrow(/HTTPS/);
    expect(() => loadEnv({ ...base, S3_PUBLIC_BASE_URL: "https://cdn.example.com" })).toThrow(/S3_BUCKET/);
  });
});
