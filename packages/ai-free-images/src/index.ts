/**
 * Image providers with a free tier, so a workspace can make pictures without
 * a paid key:
 *
 * - Hugging Face Inference (https://huggingface.co/docs/inference-providers):
 *   a free account token carries monthly credits; FLUX.1 [schnell] answers in
 *   a few seconds.
 * - Pollinations (https://pollinations.ai): open image API that needs no key
 *   at all (rate-limited, watermark-free with `nologo`); a token lifts limits.
 *
 * Both only draw. Text calls are refused so routing never lands on them for
 * writing; the model catalogue tags them "image" only.
 */
import {
  AIError,
  type AIProvider,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type ImageRequest,
  type ImageResponse,
  type ProviderAuth,
  type TextRequest,
  type TextResponse,
} from "@platform/ai-core";

const REQUEST_TIMEOUT_MS = 90_000;

function sizeOf(size: ImageRequest["size"] | undefined): { width: number; height: number } {
  const [w, h] = (size ?? "1024x1024").split("x").map((n) => Number.parseInt(n, 10));
  return { width: w && w > 0 ? w : 1024, height: h && h > 0 ? h : 1024 };
}

async function fetchImageBytes(
  provider: string,
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<{ base64: string; mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw AIError.fromHttp(provider, res.status, text || { error: { message: `${provider} responded ${res.status}` } });
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      const text = await res.text().catch(() => "");
      throw new AIError(`${provider} did not return an image (${type || "no content type"}): ${text.slice(0, 200)}`, "PROVIDER_UNAVAILABLE", true, provider, res.status);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { base64: bytes.toString("base64"), mimeType: type.split(";")[0] ?? "image/png" };
  } catch (error) {
    if (error instanceof AIError) throw error;
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AIError(aborted ? `${provider} timed out` : `${provider} unreachable: ${(error as Error).message}`, aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE", true, provider);
  } finally {
    clearTimeout(timer);
  }
}

function refuseText(provider: string): never {
  throw new AIError(`${provider} only generates images`, "INVALID_REQUEST", false, provider);
}

// ---------------------------------------------------------------------------
// Hugging Face Inference
// ---------------------------------------------------------------------------

const HF_DEFAULT_BASE = "https://router.huggingface.co/hf-inference";
export const HF_IMAGE_MODELS = [
  { id: "black-forest-labs/FLUX.1-schnell", displayName: "FLUX.1 schnell (Hugging Face)" },
  { id: "stabilityai/stable-diffusion-xl-base-1.0", displayName: "Stable Diffusion XL (Hugging Face)" },
] as const;

export class HuggingFaceProvider implements AIProvider {
  readonly name = "HUGGINGFACE" as const;
  constructor(private readonly opts: { fetchImpl?: typeof fetch } = {}) {}

  async generateText(_req: TextRequest, _auth: ProviderAuth): Promise<TextResponse> {
    return refuseText(this.name);
  }

  async embed(_req: EmbeddingRequest, _auth: ProviderAuth): Promise<EmbeddingResponse> {
    return refuseText(this.name);
  }

  async generateImage(req: ImageRequest, auth: ProviderAuth): Promise<ImageResponse> {
    const started = Date.now();
    const { width, height } = sizeOf(req.size);
    const base = auth.baseUrl ?? HF_DEFAULT_BASE;
    const count = Math.max(1, Math.min(4, req.n ?? 1));
    const images: ImageResponse["images"] = [];
    for (let i = 0; i < count; i++) {
      images.push(
        await fetchImageBytes(
          this.name,
          `${base}/models/${req.model}`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${auth.apiKey}`, "content-type": "application/json", accept: "image/png" },
            body: JSON.stringify({ inputs: req.prompt, parameters: { width, height } }),
          },
          this.opts.fetchImpl ?? fetch,
        ),
      );
    }
    return { images, model: req.model, provider: this.name, latencyMs: Date.now() - started };
  }

  async healthCheck(auth: ProviderAuth): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await (this.opts.fetchImpl ?? fetch)("https://huggingface.co/api/whoami-v2", {
        headers: { authorization: `Bearer ${auth.apiKey}` },
      });
      if (!res.ok) return { ok: false, message: `Hugging Face responded ${res.status}` };
      const data = (await res.json()) as { name?: string };
      return { ok: true, message: data.name ? `Signed in as ${data.name}` : "Token accepted" };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listModels(_auth: ProviderAuth) {
    return HF_IMAGE_MODELS.map((m) => ({ id: m.id, displayName: m.displayName, capabilities: ["image"] }));
  }
}

// ---------------------------------------------------------------------------
// Pollinations
// ---------------------------------------------------------------------------

const POLLINATIONS_BASE = "https://image.pollinations.ai";
export const POLLINATIONS_MODELS = [
  { id: "flux", displayName: "Flux (Pollinations, free)" },
  { id: "turbo", displayName: "Turbo (Pollinations, free)" },
] as const;

export class PollinationsProvider implements AIProvider {
  readonly name = "POLLINATIONS" as const;
  constructor(private readonly opts: { fetchImpl?: typeof fetch; random?: () => number } = {}) {}

  async generateText(_req: TextRequest, _auth: ProviderAuth): Promise<TextResponse> {
    return refuseText(this.name);
  }

  async embed(_req: EmbeddingRequest, _auth: ProviderAuth): Promise<EmbeddingResponse> {
    return refuseText(this.name);
  }

  async generateImage(req: ImageRequest, auth: ProviderAuth): Promise<ImageResponse> {
    const started = Date.now();
    const { width, height } = sizeOf(req.size);
    const base = auth.baseUrl ?? POLLINATIONS_BASE;
    const count = Math.max(1, Math.min(4, req.n ?? 1));
    const random = this.opts.random ?? Math.random;
    const images: ImageResponse["images"] = [];
    for (let i = 0; i < count; i++) {
      const seed = Math.floor(random() * 1_000_000_000);
      const params = new URLSearchParams({ width: String(width), height: String(height), model: req.model, seed: String(seed), nologo: "true" });
      images.push(
        await fetchImageBytes(
          this.name,
          `${base}/prompt/${encodeURIComponent(req.prompt)}?${params.toString()}`,
          { method: "GET", headers: auth.apiKey ? { authorization: `Bearer ${auth.apiKey}` } : {} },
          this.opts.fetchImpl ?? fetch,
        ),
      );
    }
    return { images, model: req.model, provider: this.name, latencyMs: Date.now() - started };
  }

  async healthCheck(auth: ProviderAuth): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(`${auth.baseUrl ?? POLLINATIONS_BASE}/models`);
      return res.ok ? { ok: true, message: auth.apiKey ? "Reachable (with token)" : "Reachable (no key)" } : { ok: false, message: `Pollinations responded ${res.status}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listModels(_auth: ProviderAuth) {
    return POLLINATIONS_MODELS.map((m) => ({ id: m.id, displayName: m.displayName, capabilities: ["image"] }));
  }
}
