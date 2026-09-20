import type { AICapability, AIOperation, AIProviderName, Platform } from "@platform/types";

export interface ModelInfo {
  provider: AIProviderName;
  model: string;
  capabilities: AICapability[];
  /** USD per 1M tokens */
  inputCostPerM?: number;
  outputCostPerM?: number;
  /** USD per generated image */
  imageCost?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** JSON-schema described function the model may call (a "plugin"). */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  /** Assistant turn that requested tool calls */
  toolCalls?: ToolCall[];
  /** Tool turn: which call this answers */
  toolCallId?: string;
  name?: string;
}
export type ContentPart =
  { type: "text"; text: string } | { type: "image"; url?: string; base64?: string; mimeType?: string };

export interface TextRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask for JSON output; providers use native JSON mode where available. */
  json?: boolean;
  jsonSchema?: Record<string, unknown>;
  /** Free-form tag for usage metering (e.g. "GENERATE") */
  operation?: AIOperation;
  abortSignal?: AbortSignal;
  /** Tools the model may call; when present the response may carry toolCalls instead of text. */
  tools?: ToolDefinition[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextResponse {
  text: string;
  /** Present when the model decided to call tools */
  toolCalls?: ToolCall[];
  usage: Usage;
  model: string;
  provider: AIProviderName;
  finishReason?: string;
  latencyMs: number;
  raw?: unknown;
}

export interface ImageRequest {
  model: string;
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024" | "1792x1024" | "1024x1792";
  n?: number;
  quality?: "standard" | "hd";
  /** Optional base image for edits (base64 PNG) */
  editBase64?: string;
  abortSignal?: AbortSignal;
}

export interface GeneratedImage {
  base64?: string;
  url?: string;
  mimeType: string;
  revisedPrompt?: string;
}

export interface ImageResponse {
  images: GeneratedImage[];
  model: string;
  provider: AIProviderName;
  latencyMs: number;
  raw?: unknown;
}

export interface EmbeddingRequest {
  model: string;
  input: string[];
}
export interface EmbeddingResponse {
  vectors: number[][];
  usage: Usage;
  model: string;
  provider: AIProviderName;
}

/**
 * Provider abstraction (spec §11). Each concrete provider is a thin, stateless
 * HTTP client; keys are injected per call so BYO-key organizations and the
 * platform key share the same code path.
 */
export interface AIProvider {
  readonly name: AIProviderName;
  generateText(req: TextRequest, auth: ProviderAuth): Promise<TextResponse>;
  generateImage?(req: ImageRequest, auth: ProviderAuth): Promise<ImageResponse>;
  embed?(req: EmbeddingRequest, auth: ProviderAuth): Promise<EmbeddingResponse>;
  /** Cheap liveness/credential check used by the admin console. */
  healthCheck?(auth: ProviderAuth): Promise<{ ok: boolean; message?: string }>;
}

export interface ProviderAuth {
  apiKey: string;
  baseUrl?: string;
}

export interface RoutingPreference {
  provider?: AIProviderName;
  model?: string;
}

export interface RoutingContext {
  /** Explicit user choice in the composer */
  user?: RoutingPreference;
  /** Organization defaults from OrganizationSettings */
  organization?: RoutingPreference;
  /** Platform default from Super Admin console */
  platform?: RoutingPreference;
  requiredCapability: AICapability;
  /** Providers for which a key is available (platform or org BYO) */
  availableProviders: AIProviderName[];
  /** Enable failover to the next candidate on transient errors */
  allowFallback?: boolean;
}

export interface RouteDecision {
  provider: AIProviderName;
  model: string;
  reason: "user" | "organization" | "platform" | "auto";
  fallbacks: { provider: AIProviderName; model: string }[];
}

export interface GenerationTarget {
  platform: Platform;
  maxLength: number;
  supportsHashtags: boolean;
}
