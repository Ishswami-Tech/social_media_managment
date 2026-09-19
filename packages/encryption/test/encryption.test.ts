import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Keyring, hmacSha256Hex, redactSecrets, safeEqual } from "../src/index";

const k1 = randomBytes(32);
const k2 = randomBytes(32).toString("hex");

describe("Keyring", () => {
  it("round-trips plaintext", () => {
    const ring = Keyring.fromEnv(k1);
    const env = ring.encrypt("access-token-123");
    expect(env.startsWith("v1.k1.")).toBe(true);
    expect(env).not.toContain("access-token-123");
    expect(ring.decrypt(env)).toBe("access-token-123");
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", () => {
    const ring = Keyring.fromEnv(k1);
    expect(ring.encrypt("same")).not.toBe(ring.encrypt("same"));
  });

  it("binds ciphertext to additional authenticated data", () => {
    const ring = Keyring.fromEnv(k1);
    const env = ring.encrypt("tok", "account:1");
    expect(ring.decrypt(env, "account:1")).toBe("tok");
    expect(() => ring.decrypt(env, "account:2")).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const ring = Keyring.fromEnv(k1);
    const env = ring.encrypt("tok");
    const parts = env.split(".");
    parts[3] = parts[3]!.slice(0, -2) + "AA";
    expect(() => ring.decrypt(parts.join("."))).toThrow();
  });

  it("supports key rotation across a keyring", () => {
    const old = new Keyring("k1", { k1 });
    const env = old.encrypt("tok");
    const ring = new Keyring("k2", { k1, k2 });
    expect(ring.needsRotation(env)).toBe(true);
    const rotated = ring.rotate(env);
    expect(rotated.startsWith("v1.k2.")).toBe(true);
    expect(ring.decrypt(rotated)).toBe("tok");
    expect(ring.needsRotation(rotated)).toBe(false);
  });

  it("accepts hex and base64 key encodings", () => {
    expect(() => Keyring.fromEnv(k2)).not.toThrow();
    expect(() => Keyring.fromEnv(k1.toString("base64"))).not.toThrow();
    expect(() => Keyring.fromEnv("short")).toThrow();
  });

  it("encrypts JSON payloads", () => {
    const ring = Keyring.fromEnv(k1);
    const env = ring.encryptJson({ scopes: ["a", "b"] });
    expect(ring.decryptJson<{ scopes: string[] }>(env).scopes).toEqual(["a", "b"]);
  });
});

describe("helpers", () => {
  it("safeEqual compares strings safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });

  it("hmacSha256Hex is deterministic", () => {
    expect(hmacSha256Hex("s", "p")).toBe(hmacSha256Hex("s", "p"));
    expect(hmacSha256Hex("s", "p")).toHaveLength(64);
  });

  it("redactSecrets masks secret-looking keys recursively", () => {
    const out = redactSecrets({ accessToken: "x", nested: { api_key: "y", ok: 1 }, list: [{ password: "z" }] });
    expect(out).toEqual({
      accessToken: "[REDACTED]",
      nested: { api_key: "[REDACTED]", ok: 1 },
      list: [{ password: "[REDACTED]" }],
    });
  });
});
