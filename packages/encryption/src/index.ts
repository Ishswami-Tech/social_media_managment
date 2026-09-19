import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope format (all base64url, dot separated):
 *   v1.<keyId>.<iv>.<ciphertext>.<authTag>
 *
 * - AES-256-GCM, 12-byte IV, 16-byte auth tag.
 * - keyId allows key rotation: a Keyring can decrypt with any known key while
 *   always encrypting with the current one.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type KeyMaterial = Buffer | string;

function toKeyBuffer(material: KeyMaterial): Buffer {
  if (Buffer.isBuffer(material)) {
    if (material.length !== 32) throw new Error("Encryption key must be exactly 32 bytes");
    return material;
  }
  const trimmed = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const b64 = Buffer.from(trimmed, "base64");
  if (b64.length === 32) return b64;
  throw new Error("Encryption key must be 32 bytes encoded as hex (64 chars) or base64 (44 chars)");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export class Keyring {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    private readonly currentKeyId: string,
    keys: Record<string, KeyMaterial>,
  ) {
    for (const [id, material] of Object.entries(keys)) this.keys.set(id, toKeyBuffer(material));
    if (!this.keys.has(currentKeyId)) throw new Error(`Current key "${currentKeyId}" missing from keyring`);
  }

  /** Build a single-key keyring from ENCRYPTION_KEY. keyId defaults to "k1". */
  static fromEnv(key: KeyMaterial, keyId = "k1"): Keyring {
    return new Keyring(keyId, { [keyId]: key });
  }

  encrypt(plaintext: string, aad?: string): string {
    const key = this.keys.get(this.currentKeyId)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, this.currentKeyId, b64url(iv), b64url(ciphertext), b64url(tag)].join(".");
  }

  decrypt(envelope: string, aad?: string): string {
    const parts = envelope.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION) throw new Error("Malformed encrypted envelope");
    const [, keyId, ivB64, ctB64, tagB64] = parts as [string, string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Unknown encryption key id "${keyId}"`);
    const decipher = createDecipheriv("aes-256-gcm", key, fromB64url(ivB64), { authTagLength: TAG_BYTES });
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(fromB64url(tagB64));
    return Buffer.concat([decipher.update(fromB64url(ctB64)), decipher.final()]).toString("utf8");
  }

  /** True if the envelope was encrypted with a key other than the current one. */
  needsRotation(envelope: string): boolean {
    const keyId = envelope.split(".")[1];
    return keyId !== this.currentKeyId;
  }

  /** Re-encrypt an envelope with the current key (no-op if already current). */
  rotate(envelope: string, aad?: string): string {
    if (!this.needsRotation(envelope)) return envelope;
    return this.encrypt(this.decrypt(envelope, aad), aad);
  }

  encryptJson(value: unknown, aad?: string): string {
    return this.encrypt(JSON.stringify(value), aad);
  }

  decryptJson<T = unknown>(envelope: string, aad?: string): T {
    return JSON.parse(this.decrypt(envelope, aad)) as T;
  }
}

/** Constant-time string comparison for tokens/signatures. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function sha256Hex(payload: string | Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Redact anything that looks like a secret before it reaches logs.
 * Applied by the logger and by audit-log metadata serialisation.
 */
const SECRET_KEYS = /token|secret|password|apikey|api_key|authorization|cookie|credential/i;
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : redactSecrets(v, depth + 1);
  }
  return out as T;
}
