import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { startHealthServer } from "@/workers/health";

/**
 * Hosts that treat every service alike wait for an HTTP answer before they
 * accept a container, so the worker's probe has to be there and has to tell
 * the truth about whether the queues are still running.
 */
let server: Server | undefined;
afterEach(() => server?.close());

async function get(port: number, path = "/"): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

function freePort(): number {
  return 39000 + Math.floor(Math.random() * 2000);
}

describe("the worker's health endpoint", () => {
  it("answers 200 with the queues it is running", async () => {
    const port = freePort();
    server = await startHealthServer({ queues: ["publish", "agent-run"], running: () => true }, port);
    expect(server).toBeDefined();
    const { status, body } = await get(port, "/api/health");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, service: "worker", queues: ["publish", "agent-run"] });
  });

  it("answers 503 once the worker is shutting down", async () => {
    const port = freePort();
    let running = true;
    server = await startHealthServer({ queues: ["publish"], running: () => running }, port);
    running = false;
    const { status, body } = await get(port);
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false });
  });

  it("does not take the process down when the port is already taken", async () => {
    const port = freePort();
    server = await startHealthServer({ queues: [], running: () => true }, port);
    const second = await startHealthServer({ queues: [], running: () => true }, port);
    expect(second).toBeUndefined();
  });
});
