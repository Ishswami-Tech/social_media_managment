import { deflateSync } from "node:zlib";
import type { AIProviderName, Platform } from "@platform/types";
import { PLATFORMS } from "@platform/types";
import type {
  AIProvider,
  ChatMessage,
  ImageRequest,
  ImageResponse,
  ProviderAuth,
  TextRequest,
  TextResponse,
} from "./types";

/**
 * Deterministic, offline stand-in for a real model. Enabled with `AI_MOCK=1`
 * so the AI Studio, composer and research skills can be exercised end to end
 * (routing, metering, media pipeline, approvals) without any provider key.
 * Every response is derived from the prompt so the UI shows realistic output.
 */
export class MockProvider implements AIProvider {
  constructor(readonly name: AIProviderName) {}

  async generateText(req: TextRequest, _auth: ProviderAuth): Promise<TextResponse> {
    const started = Date.now();
    const user = lastText(req.messages, "user");
    const text = answer(req, user);
    return {
      text,
      usage: { inputTokens: tokens(req.messages), outputTokens: Math.ceil(text.length / 4) },
      model: req.model,
      provider: this.name,
      finishReason: "stop",
      latencyMs: Date.now() - started,
    };
  }

  async generateImage(req: ImageRequest, _auth: ProviderAuth): Promise<ImageResponse> {
    const started = Date.now();
    const [w, h] = (req.size ?? "1024x1024").split("x").map(Number) as [number, number];
    const images = Array.from({ length: req.n ?? 1 }, (_, i) => ({
      base64: placeholderPng(w, h, hash(`${req.prompt}:${i}`)).toString("base64"),
      mimeType: "image/png",
      revisedPrompt: req.prompt,
    }));
    return { images, model: req.model, provider: this.name, latencyMs: Date.now() - started };
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: "mock provider (AI_MOCK=1)" };
  }
}

// ---------------------------------------------------------------------------

function lastText(messages: ChatMessage[], role: ChatMessage["role"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== role) continue;
    return typeof m.content === "string"
      ? m.content
      : m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  }
  return "";
}

function tokens(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + Math.ceil((typeof m.content === "string" ? m.content : "").length / 4), 0);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The text the operation is about: what follows "Text:" / "Idea / source:" or the whole message. */
function subject(user: string): string {
  const m = user.match(
    /(?:Text|Idea \/ source|Idea|Conversation):\n([\s\S]*?)(?:\n\nJSON shape|\n\nExtra instructions|$)/,
  );
  return (m?.[1] ?? user).trim();
}

function keywords(text: string, n: number): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "our",
    "your",
    "from",
    "have",
    "are",
    "you",
    "will",
    "just",
    "here",
    "come",
    "try",
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
    if (stop.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= n) break;
  }
  return out;
}

function platformsIn(user: string): Platform[] {
  const found = PLATFORMS.filter((p) => new RegExp(`\\b${p}\\b`).test(user));
  return found.length ? found : ["LINKEDIN"];
}

function firstSentence(text: string): string {
  return (text.split(/(?<=[.!?])\s+/)[0] ?? text).replace(/#\S+/g, "").trim();
}

function answer(req: TextRequest, user: string): string {
  const body = subject(user);
  const tags = keywords(body, 5).map((k) => `#${k}`);
  switch (req.operation) {
    case "REWRITE":
      return rewrite(body);
    case "SHORTEN":
      return shorten(body);
    case "EXPAND":
      return `${body}\n\nHere is why it matters: ${firstSentence(body).toLowerCase() || "it delivers on a real need"}. We built this with our community in mind, and we would love to hear what you think.`;
    case "TRANSLATE":
      return `[translated] ${body}`;
    case "HASHTAGS":
      return JSON.stringify({ hashtags: [...tags, "#community", "#growth", "#behindthescenes"].slice(0, 10) });
    case "HOOKS":
      return JSON.stringify({
        hooks: [
          `Stop scrolling: ${firstSentence(body)}`,
          "We almost didn't ship this.",
          "Three things we learned the hard way.",
          "Here's what nobody tells you.",
          "A small change with a big result.",
        ],
        ctas: [
          "Tell us what you think in the comments",
          "Save this for later",
          "Share it with someone who needs it",
          "Follow for the next update",
          "Link in bio",
        ],
      });
    case "PLATFORM_ADAPT":
      return JSON.stringify({
        variants: platformsIn(user).map((platform) => ({
          platform,
          text: adapt(platform, body),
          hashtags: tags,
          hook: firstSentence(body),
          cta: platform === "INSTAGRAM" ? "Link in bio" : "Tell us what you think",
        })),
      });
    case "CALENDAR": {
      const platforms = platformsIn(user);
      const items = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i + 1);
        const platform = platforms[i % platforms.length]!;
        return {
          date: d.toISOString().slice(0, 10),
          platform,
          title: [
            "Behind the scenes",
            "Customer story",
            "Tip of the week",
            "Product spotlight",
            "Team introduction",
            "Community question",
            "Weekly recap",
          ][i]!,
          idea: `${["Show", "Share", "Explain", "Highlight", "Introduce", "Ask", "Summarise"][i]} something about: ${firstSentence(body) || body.slice(0, 80)}`,
          format: platform === "INSTAGRAM" ? "carousel" : "text",
        };
      });
      return JSON.stringify({ items });
    }
    case "QUALITY_CHECK": {
      const issues = [];
      if (body.length > 1200)
        issues.push({ type: "length", message: "Long for a feed post; consider trimming.", severity: "medium" });
      if (!/#/.test(body))
        issues.push({ type: "hashtags", message: "No hashtags; add 2–5 relevant ones.", severity: "low" });
      if (!/[?!]/.test(body))
        issues.push({ type: "engagement", message: "No question or call to action.", severity: "low" });
      return JSON.stringify({
        score: Math.max(40, 92 - issues.length * 12),
        issues,
        suggestions: ["Open with the strongest sentence.", "End with one clear call to action."],
      });
    }
    case "REPLY_SUGGEST":
      return JSON.stringify({
        reply:
          "Thanks for reaching out! Happy to help — could you share a few more details so we can sort this out quickly?",
        tone: "friendly",
        needsHuman: false,
        reason: "Routine question",
      });
    default:
      return req.json ? brief(body, platformsIn(user), tags) : rewrite(body);
  }
}

function rewrite(text: string): string {
  const swapped = text
    .replace(/\bjust launched\b/gi, "proudly introduced")
    .replace(/\bfinally here\b/gi, "available now")
    .replace(/\bWe\b/g, "Our team")
    .replace(/\bwe\b/g, "our team");
  return swapped === text ? `Big news: ${text}` : swapped;
}

function shorten(text: string): string {
  const sentences = text.split(/\n+|(?<=[.!?])\s+/).filter(Boolean);
  const tags = text.match(/#\S+/g) ?? [];
  return [
    ...sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 2))).filter((s) => !s.startsWith("#")),
    tags.join(" "),
  ]
    .filter(Boolean)
    .join("\n");
}

function adapt(platform: Platform, text: string): string {
  const clean = text.replace(/#\S+\s*/g, "").trim();
  switch (platform) {
    case "INSTAGRAM":
      return `${firstSentence(clean)} ✨\n\n${clean.split("\n").slice(1).join("\n").trim()}\n\nTap the link in bio 👆`.trim();
    case "FACEBOOK":
      return `${clean}\n\nWhat do you think? Tell us in the comments 👇`;
    case "X":
      return firstSentence(clean).slice(0, 240);
    default:
      return `${clean}\n\nWhat has your experience been? I'd love to hear it in the comments.`;
  }
}

function brief(input: string, platforms: Platform[], tags: string[]): string {
  const topic = firstSentence(input) || input.slice(0, 80);
  return JSON.stringify({
    title: `Research brief: ${topic}`,
    summary: `${topic} is drawing steady attention. Audiences respond best to concrete examples, first-person stories and a single clear takeaway per post. (Generated by the offline mock provider; connect a real model and search connector for live research.)`,
    keyPoints: [
      "Lead with a specific, verifiable detail rather than a general claim.",
      "Short paragraphs and one idea per post outperform long explainers on feeds.",
      "Posts that ask a direct question get more replies than posts that only announce.",
    ],
    angles: [
      { hook: `What nobody tells you about ${topic.toLowerCase()}`, why: "Curiosity gap with a concrete promise" },
      { hook: "We tried this for 30 days. Here's what happened.", why: "Time-boxed experiment stories perform well" },
    ],
    postIdeas: platforms.map((platform) => ({ platform, text: adapt(platform, input), hashtags: tags })),
    sources: [{ title: "Mock source", url: "https://example.com/research", note: "Placeholder while AI_MOCK=1" }],
    caveats: ["Generated offline by the mock provider; verify facts before publishing."],
  });
}

/** Minimal PNG encoder (RGB, no dependencies): a two-tone diagonal gradient seeded from the prompt. */
export function placeholderPng(width: number, height: number, seed: number): Buffer {
  const a = [(seed >>> 16) & 255, (seed >>> 8) & 255, seed & 255];
  const b = [255 - a[0]!, (a[1]! + 96) & 255, (a[2]! + 160) & 255];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      const o = row + 1 + x * 3;
      raw[o] = Math.round(a[0]! + (b[0]! - a[0]!) * t);
      raw[o + 1] = Math.round(a[1]! + (b[1]! - a[1]!) * t);
      raw[o + 2] = Math.round(a[2]! + (b[2]! - a[2]!) * t);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let crcTable: Uint32Array | undefined;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
