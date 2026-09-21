import type { Tool } from "@platform/ai-core";

/**
 * Plugins are external tools the model can call during a skill run:
 * - MCP servers speaking the streamable-HTTP transport (JSON-RPC 2.0), whose
 *   tools are discovered with `tools/list` and invoked with `tools/call`;
 * - plain HTTP endpoints that accept the tool arguments as a JSON body.
 * Secrets (headers) are decrypted by the caller and never logged.
 */
export interface PluginDefinition {
  slug: string;
  name: string;
  description: string;
  kind: "MCP" | "HTTP";
  url: string;
  headers?: Record<string, string>;
  /** HTTP plugins only: JSON schema for the arguments and the method to use. */
  inputSchema?: Record<string, unknown>;
  method?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
const TOOL_NAME_MAX = 64;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Provider tool names must match ^[a-zA-Z0-9_-]{1,64}$. */
export function pluginToolName(pluginSlug: string, toolName?: string): string {
  const raw = toolName ? `${pluginSlug}__${toolName}` : pluginSlug;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, TOOL_NAME_MAX);
}

interface JsonRpcResponse {
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Reads either a JSON body or an SSE stream and returns the JSON-RPC response with the given id. */
async function readJsonRpc(res: Response, id: number): Promise<JsonRpcResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!contentType.includes("text/event-stream")) {
    if (!text.trim()) return {};
    return JSON.parse(text) as JsonRpcResponse;
  }
  for (const block of text.split(/\n\n+/)) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n");
    if (!data) continue;
    try {
      const msg = JSON.parse(data) as JsonRpcResponse;
      if (msg.id === id) return msg;
    } catch {
      /* ignore non-JSON events */
    }
  }
  throw new Error("MCP server returned no response for the request");
}

/**
 * Minimal MCP client over streamable HTTP: one session per instance,
 * initialised lazily. Enough for tools/list and tools/call, which is all a
 * content agent needs.
 */
export class McpClient {
  private nextId = 1;
  private sessionId: string | undefined;
  private initialised = false;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  private async rpc<T>(method: string, params?: unknown, notification = false): Promise<T> {
    const id = this.nextId++;
    const body = notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params };
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        ...this.headers,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (!res.ok) throw new Error(`MCP server responded ${res.status} to ${method}`);
    if (notification) return undefined as T;
    const msg = await readJsonRpc(res, id);
    if (msg.error) throw new Error(`MCP ${method} failed: ${msg.error.message}`);
    return msg.result as T;
  }

  async initialize(): Promise<void> {
    if (this.initialised) return;
    await this.rpc("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "social-ai-platform", version: "1.0" },
    });
    await this.rpc("notifications/initialized", undefined, true);
    this.initialised = true;
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialize();
    const result = await this.rpc<{ tools?: McpToolInfo[] }>("tools/list", {});
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialize();
    const result = await this.rpc<{
      content?: { type: string; text?: string; [k: string]: unknown }[];
      structuredContent?: unknown;
      isError?: boolean;
    }>("tools/call", { name, arguments: args });
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = (result.content ?? [])
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
      .join("\n");
    if (result.isError) throw new Error(text || "Tool reported an error");
    return text;
  }
}

async function callHttpPlugin(def: PluginDefinition, args: Record<string, unknown>, fetchImpl: typeof fetch) {
  const method = (def.method ?? "POST").toUpperCase();
  const url = new URL(def.url);
  const init: RequestInit = {
    method,
    headers: { ...(def.headers ?? {}), accept: "application/json, text/plain" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  };
  if (method === "GET") {
    for (const [k, v] of Object.entries(args)) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  } else {
    init.headers = { ...(init.headers as Record<string, string>), "content-type": "application/json" };
    init.body = JSON.stringify(args);
  }
  const res = await fetchImpl(url.toString(), init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${url.host} responded ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Turns plugin definitions into agent tools. MCP servers are queried for their
 * tool list; a server that cannot be reached is skipped (and reported via
 * `onError`) so one broken plugin never blocks a skill run.
 */
export async function buildPluginTools(
  plugins: PluginDefinition[],
  opts: { fetchImpl?: typeof fetch; onError?: (plugin: PluginDefinition, error: Error) => void } = {},
): Promise<Tool[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tools: Tool[] = [];
  for (const def of plugins) {
    if (def.kind === "HTTP") {
      tools.push({
        definition: {
          name: pluginToolName(def.slug),
          description: def.description || def.name,
          parameters: def.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
        },
        run: (args) => callHttpPlugin(def, args as Record<string, unknown>, fetchImpl),
      });
      continue;
    }
    const client = new McpClient(def.url, def.headers, fetchImpl);
    try {
      const listed = await client.listTools();
      for (const t of listed) {
        tools.push({
          definition: {
            name: pluginToolName(def.slug, t.name),
            description: `${def.name}: ${t.description ?? t.name}`,
            parameters: t.inputSchema ?? { type: "object", properties: {} },
          },
          run: (args) => client.callTool(t.name, args as Record<string, unknown>),
        });
      }
    } catch (e) {
      opts.onError?.(def, e as Error);
    }
  }
  return tools;
}
