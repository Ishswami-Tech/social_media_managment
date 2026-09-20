import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Optional CDN base URL for public reads */
  publicBaseUrl?: string;
  /** Override endpoint (e.g. MinIO in dev) */
  endpoint?: string;
}

export type StorageKind = "r2" | "memory" | "disk";

export interface ObjectStorage {
  /** Backend identifier; compare this rather than using instanceof (module identity can differ under hot reload). */
  readonly kind: StorageKind;
  signedUploadUrl(key: string, mimeType: string, expiresInSeconds?: number): Promise<string>;
  signedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  putObject(key: string, body: Uint8Array | Buffer, mimeType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  head(key: string): Promise<{ size: number; mimeType?: string } | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string | undefined;
}

/** Cloudflare R2 (S3-compatible) storage client. */
export class R2Storage implements ObjectStorage {
  readonly kind = "r2" as const;
  private readonly client: S3Client;

  constructor(private readonly cfg: StorageConfig) {
    this.client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: !!cfg.endpoint,
    });
  }

  signedUploadUrl(key: string, mimeType: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: mimeType }),
      { expiresIn: expiresInSeconds },
    );
  }

  signedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async putObject(key: string, body: Uint8Array | Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: mimeType }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object ${key} has no body`);
    return Buffer.from(bytes);
  }

  async head(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, mimeType: res.ContentType };
    } catch (e) {
      if (
        (e as { name?: string }).name === "NotFound" ||
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      )
        return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  publicUrl(key: string): string | undefined {
    return this.cfg.publicBaseUrl ? `${this.cfg.publicBaseUrl.replace(/\/$/, "")}/${key}` : undefined;
  }
}

/** In-memory storage for tests and local development without R2 credentials. */
export class MemoryStorage implements ObjectStorage {
  readonly kind = "memory" as const;
  readonly objects = new Map<string, { body: Buffer; mimeType: string }>();
  constructor(private readonly baseUrl = "memory://bucket") {}
  async signedUploadUrl(key: string) {
    return `${this.baseUrl}/upload/${key}`;
  }
  async signedDownloadUrl(key: string) {
    return `${this.baseUrl}/${key}`;
  }
  async putObject(key: string, body: Uint8Array | Buffer, mimeType: string) {
    this.objects.set(key, { body: Buffer.from(body), mimeType });
  }
  async getObject(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error(`missing ${key}`);
    return o.body;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.body.length, mimeType: o.mimeType } : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  publicUrl(key: string) {
    return `${this.baseUrl}/${key}`;
  }
}

/**
 * Local-disk storage for development and single-node deployments without R2.
 * Objects live under `rootDir/<key>`; both the web and worker processes see
 * the same files. Signed URLs point at the app's dev media route.
 */
export class DiskStorage implements ObjectStorage {
  readonly kind = "disk" as const;
  constructor(
    private readonly rootDir: string,
    private readonly baseUrl: string,
  ) {}

  private async fsp() {
    return import("node:fs/promises");
  }

  private pathFor(key: string): string {
    const safe = key.replace(/\.\.+/g, "").replace(/^\/+/, "");
    return `${this.rootDir}/${safe}`;
  }

  async signedUploadUrl(key: string) {
    return `${this.baseUrl}?key=${encodeURIComponent(key)}`;
  }

  async signedDownloadUrl(key: string) {
    return `${this.baseUrl}?key=${encodeURIComponent(key)}`;
  }

  async putObject(key: string, body: Uint8Array | Buffer, mimeType: string) {
    const fs = await this.fsp();
    const file = this.pathFor(key);
    await fs.mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(file, body);
    await fs.writeFile(`${file}.meta`, JSON.stringify({ mimeType }));
  }

  async getObject(key: string) {
    const fs = await this.fsp();
    return fs.readFile(this.pathFor(key));
  }

  async getMimeType(key: string): Promise<string | undefined> {
    const fs = await this.fsp();
    try {
      return (JSON.parse(await fs.readFile(`${this.pathFor(key)}.meta`, "utf8")) as { mimeType?: string }).mimeType;
    } catch {
      return undefined;
    }
  }

  async head(key: string) {
    const fs = await this.fsp();
    try {
      const stat = await fs.stat(this.pathFor(key));
      return { size: stat.size, mimeType: await this.getMimeType(key) };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    const fs = await this.fsp();
    await fs.rm(this.pathFor(key), { force: true });
    await fs.rm(`${this.pathFor(key)}.meta`, { force: true });
  }

  publicUrl(key: string) {
    return `${this.baseUrl}?key=${encodeURIComponent(key)}`;
  }
}
