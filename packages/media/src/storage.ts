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

export interface ObjectStorage {
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
