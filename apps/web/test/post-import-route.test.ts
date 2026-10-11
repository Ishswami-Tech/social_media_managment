import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tx: {
    post: { findMany: vi.fn(), create: vi.fn() },
    socialAccount: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  transaction: vi.fn(),
  ctx: { organization: { id: "workspace" }, user: { id: "author" }, settings: { timezone: "Asia/Kolkata" } },
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/api", () => ({
  json: (data: unknown, options: ResponseInit) => Response.json(data, options),
  parseBody: async (request: Request, schema: { parse: (input: unknown) => unknown }) =>
    schema.parse(await request.json()),
  withOrg: async (_request: Request, _capability: string, handler: (ctx: typeof mocks.ctx) => unknown) =>
    handler(mocks.ctx),
  badRequest: (message: string) => new Error(message),
  conflict: (message: string) => new Error(message),
}));
import { POST } from "@/app/api/posts/import/route";

function request() {
  return new Request("http://localhost/api/posts/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      importId: "ae6f33a0-a8e4-40c0-b4d1-f51d12736a48",
      accountIds: ["account"],
      rows: [{ title: "Launch", text: "Caption", scheduledAt: "2027-01-01T09:00:00+05:30", tags: [] }],
    }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((handler: (tx: typeof mocks.tx) => unknown) => handler(mocks.tx));
  mocks.tx.post.findMany.mockResolvedValue([]);
  mocks.tx.socialAccount.findMany.mockResolvedValue([{ id: "account", platform: "FACEBOOK", status: "CONNECTED" }]);
  mocks.tx.post.create.mockResolvedValue({ id: "draft" });
});

describe("CSV draft import boundary", () => {
  it("keeps planned dates as drafts without enabling automatic publication", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.tx.post.create.mock.calls[0]![0].data).toMatchObject({
      organizationId: "workspace",
      createdById: "author",
      status: "DRAFT",
      autoPublishOnApproval: false,
      scheduledAt: new Date("2027-01-01T03:30:00Z"),
      timezone: "Asia/Kolkata",
    });
  });
  it("does not duplicate a completed import when its response was lost and the user retries", async () => {
    mocks.tx.post.findMany.mockResolvedValue([{ id: "previous-draft" }]);
    const response = await POST(request());
    expect(await response.json()).toEqual({ posts: [{ id: "previous-draft" }], reused: true });
    expect(mocks.tx.post.create).not.toHaveBeenCalled();
    expect(mocks.tx.post.findMany.mock.calls[0]![0].where).toMatchObject({
      organizationId: "workspace",
      createdById: "author",
    });
  });
  it("rejects accounts outside the workspace before creating any drafts", async () => {
    mocks.tx.socialAccount.findMany.mockResolvedValue([]);
    await expect(POST(request())).rejects.toThrow("from this workspace");
    expect(mocks.tx.post.create).not.toHaveBeenCalled();
    expect(mocks.tx.socialAccount.findMany.mock.calls[0]![0].where.organizationId).toBe("workspace");
  });
  it("requires selected accounts to be connected", async () => {
    mocks.tx.socialAccount.findMany.mockResolvedValue([{ id: "account", platform: "FACEBOOK", status: "EXPIRED" }]);
    await expect(POST(request())).rejects.toThrow("Reconnect");
    expect(mocks.tx.post.create).not.toHaveBeenCalled();
  });
});
