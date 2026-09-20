import { withUser } from "@/lib/api";
import { localStorageBackend } from "@/lib/storage";

/**
 * Upload/download endpoint for the local-disk storage backend (used when R2
 * is not configured). Never mounted for R2: uploads then go straight to the
 * bucket via signed URLs. Every key is tenant-prefixed and access requires a
 * session; keys are validated to stay inside the media namespace.
 */
const KEY = /^org\/[A-Za-z0-9_-]+\/media\/[A-Za-z0-9_.-]+$/;

export const PUT = (req: Request) =>
  withUser(req, async () => {
    const disk = localStorageBackend();
    const key = new URL(req.url).searchParams.get("key");
    if (!disk || !key || !KEY.test(key)) return new Response("Not found", { status: 404 });
    await disk.putObject(
      key,
      Buffer.from(await req.arrayBuffer()),
      req.headers.get("content-type") ?? "application/octet-stream",
    );
    return new Response(null, { status: 200 });
  });

export const GET = (req: Request) =>
  withUser(req, async () => {
    const disk = localStorageBackend();
    const key = new URL(req.url).searchParams.get("key");
    if (!disk || !key || !KEY.test(key)) return new Response("Not found", { status: 404 });
    const head = await disk.head(key);
    if (!head) return new Response("Not found", { status: 404 });
    const body = await disk.getObject(key);
    return new Response(new Uint8Array(body), {
      headers: { "content-type": head.mimeType ?? "application/octet-stream", "cache-control": "private, max-age=300" },
    });
  });
