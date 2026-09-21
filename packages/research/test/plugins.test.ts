import { describe, expect, it, vi } from "vitest";
import { buildPluginTools, McpClient, pluginToolName } from "../src/plugins";

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

/** Fake MCP server over streamable HTTP: JSON for most calls, SSE for tools/call. */
function fakeMcp() {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body, headers: init?.headers as Record<string, string> });
    const reply = (result: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json", ...headers },
      });
    switch (body.method) {
      case "initialize":
        return reply({ protocolVersion: "2025-06-18", capabilities: {} }, { "mcp-session-id": "sess-1" });
      case "notifications/initialized":
        return new Response(null, { status: 202 });
      case "tools/list":
        return reply({
          tools: [{ name: "lookup_customer", description: "Find a customer", inputSchema: { type: "object", properties: { email: { type: "string" } } } }],
        });
      case "tools/call": {
        const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "Ada, VIP" }] } })}\n\n`;
        return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      default:
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unknown" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
    }
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("McpClient", () => {
  it("initialises once, keeps the session id, lists tools and reads SSE tool results", async () => {
    const { fetchImpl, calls } = fakeMcp();
    const client = new McpClient("https://mcp.example/mcp", { authorization: "Bearer t" }, fetchImpl);
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["lookup_customer"]);
    const result = await client.callTool("lookup_customer", { email: "a@b.c" });
    expect(result).toBe("Ada, VIP");
    expect(calls.map((c) => c.body.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(calls[3]!.headers["mcp-session-id"]).toBe("sess-1");
    expect(calls[3]!.headers.authorization).toBe("Bearer t");
  });

  it("surfaces JSON-RPC errors", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: 1, message: "nope" } }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new McpClient("https://mcp.example/mcp", {}, fetchImpl);
    await expect(client.listTools()).rejects.toThrow(/nope/);
  });
});

describe("buildPluginTools", () => {
  it("exposes MCP tools with prefixed names and HTTP endpoints as single tools", async () => {
    const { fetchImpl } = fakeMcp();
    const httpFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.example/lookup");
      expect(JSON.parse(String(init?.body))).toEqual({ query: "x" });
      return new Response(JSON.stringify({ hits: 2 }), { headers: { "content-type": "application/json" } });
    });
    const combined = (async (url: string | URL | Request, init?: RequestInit) =>
      String(url).includes("mcp.example") ? fetchImpl(url, init) : httpFetch(String(url), init)) as unknown as typeof fetch;
    const tools = await buildPluginTools(
      [
        { slug: "crm", name: "CRM", description: "Customer data", kind: "MCP", url: "https://mcp.example/mcp" },
        { slug: "search-api", name: "Search", description: "Internal search", kind: "HTTP", url: "https://api.example/lookup", inputSchema: { type: "object" } },
      ],
      { fetchImpl: combined },
    );
    expect(tools.map((t) => t.definition.name)).toEqual(["crm__lookup_customer", "search-api"]);
    expect(await tools[1]!.run({ query: "x" })).toEqual({ hits: 2 });
    expect(await tools[0]!.run({ email: "a@b.c" })).toBe("Ada, VIP");
  });

  it("skips an unreachable MCP server and reports it", async () => {
    const failing = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const onError = vi.fn();
    const tools = await buildPluginTools([{ slug: "down", name: "Down", description: "", kind: "MCP", url: "https://down.example/mcp" }], {
      fetchImpl: failing,
      onError,
    });
    expect(tools).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("sanitises tool names for provider constraints", () => {
    expect(pluginToolName("my plugin", "get.user")).toBe("my_plugin__get_user");
    expect(pluginToolName("a".repeat(100)).length).toBe(64);
  });
});
