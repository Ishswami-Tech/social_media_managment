import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { S3Storage } from "../src/storage";

describe("Contabo S3 storage", () => {
  let server: Server;
  let storage: S3Storage;
  const objects = new Map<string, Buffer>();
  const requests: { method: string; url: string; checksum?: string }[] = [];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const url = req.url!;
      requests.push({
        method: req.method!,
        url,
        checksum: req.headers["x-amz-sdk-checksum-algorithm"] as string | undefined,
      });
      const key = url.split("?")[0]!;
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        objects.set(key, Buffer.concat(chunks));
        res.end();
      } else if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204).end();
      } else if (objects.has(key)) {
        const body = objects.get(key)!;
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": body.length });
        res.end(req.method === "HEAD" ? undefined : body);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    storage = new S3Storage({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: "default",
      accessKeyId: "test-access",
      secretAccessKey: "test-secret",
      bucket: "media",
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("uploads, reads, inspects and deletes using path-style object requests", async () => {
    const key = "org/one/image.png";
    await storage.putObject(key, Buffer.from("image bytes"), "image/png");
    expect((await storage.getObject(key)).toString()).toBe("image bytes");
    expect(await storage.head(key)).toEqual({ size: 11, mimeType: "image/png" });
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    expect(requests.every((request) => request.url.startsWith("/media/org/one/image.png"))).toBe(true);
    expect(requests.find((request) => request.method === "PUT")?.checksum).toBeUndefined();
  });

  it("signs browser uploads without binding an empty-body checksum", async () => {
    const url = new URL(await storage.signedUploadUrl("org/a b.png", "image/png", 120));
    expect(url.pathname).toBe("/media/org/a%20b.png");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/default/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: "browser bytes",
    });
    expect(response.ok).toBe(true);
    expect((await storage.getObject("org/a b.png")).toString()).toBe("browser bytes");
  });

  it("keeps private media on signed URLs and encodes optional public URLs", async () => {
    expect(storage.publicUrl("org/image.png")).toBeUndefined();
    const url = new URL(await storage.signedDownloadUrl("org/image.png", 60));
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    const publicStorage = new S3Storage({
      endpoint: "https://eu2.contabostorage.com",
      region: "default",
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "media",
      publicBaseUrl: "https://cdn.example.com/media/",
    });
    expect(publicStorage.publicUrl("org/a b#c.png")).toBe("https://cdn.example.com/media/org/a%20b%23c.png");
  });
});
