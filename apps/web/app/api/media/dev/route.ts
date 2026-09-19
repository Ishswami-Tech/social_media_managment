import { MemoryStorage } from "@platform/media";
import { withUser } from "@/lib/api";
import { storage } from "@/lib/storage";

/**
 * Development-only shim that lets the in-memory storage backend accept browser
 * uploads (PUT ?key=...) and serve objects (GET ?key=...). Never used when R2
 * is configured; each key is tenant-prefixed and access requires a session.
 */
function memory(): MemoryStorage | null {
  const s = storage();
  return s instanceof MemoryStorage ? s : null;
}

export const PUT = (req: Request) =>
  withUser(req, async () => {
    const mem = memory();
    if (!mem) return new Response("Not available", { status: 404 });
    const key = new URL(req.url).searchParams.get("key");
    if (!key) return new Response("key required", { status: 400 });
    await mem.putObject(
      key,
      Buffer.from(await req.arrayBuffer()),
      req.headers.get("content-type") ?? "application/octet-stream",
    );
    return new Response(null, { status: 200 });
  });

export const GET = (req: Request) =>
  withUser(req, async () => {
    const mem = memory();
    if (!mem) return new Response("Not available", { status: 404 });
    const key = new URL(req.url).searchParams.get("key");
    const obj = key ? mem.objects.get(key) : undefined;
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(obj.body), {
      headers: { "content-type": obj.mimeType, "cache-control": "private, max-age=60" },
    });
  });
