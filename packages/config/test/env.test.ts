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
});
