import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/session";

const mocks = vi.hoisted(() => {
  const tx = {
    post: { updateMany: vi.fn(), update: vi.fn() },
    postVariant: { updateMany: vi.fn() },
    publishJob: { updateMany: vi.fn(), count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  };
  return {
    tx,
    prisma: {
      post: { findFirst: vi.fn(), updateMany: vi.fn() },
      postVariant: { updateMany: vi.fn() },
      publishJob: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
      $transaction: vi.fn(),
    },
    audit: vi.fn(),
    enqueue: vi.fn(),
  };
});
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma, keyring: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/queue", () => ({ queues: () => ({ enqueue: mocks.enqueue }) }));
vi.mock("@/lib/providers", () => ({ providers: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storage: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn() }) }, errorInfo: vi.fn() }));

import { schedulePost, cancelPost } from "@/lib/services/posts";
import { runPublishJob } from "@/lib/services/publishing";

const ctx = {
  organization: { id: "org" },
  user: { id: "author" },
  settings: { requireApproval: false },
  can: () => true,
} as unknown as OrgContext;
const when = "2027-01-15T09:00:00.000Z";
function post(status = "QUEUED") {
  return {
    id: "post",
    createdById: "author",
    status,
    scheduledAt: new Date("2027-01-14T09:00:00Z"),
    timezone: "UTC",
    approvalStatus: "NOT_REQUIRED",
    variants: [
      {
        id: "variant",
        externalPostId: null,
        status,
        socialAccount: { status: "CONNECTED", displayName: "Page", requireApproval: false },
      },
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.post.findFirst.mockResolvedValue(post());
  mocks.tx.post.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.publishJob.count.mockResolvedValue(0);
  mocks.tx.publishJob.findMany.mockResolvedValue([]);
  mocks.prisma.publishJob.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation((fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx));
});

describe("calendar rescheduling", () => {
  it("ignores a leftover queue delivery for a terminal failed revision", async () => {
    mocks.prisma.publishJob.findUnique.mockResolvedValue({ id: "old-job", status: "FAILED" });
    await expect(runPublishJob("old-job")).resolves.toBeUndefined();
    expect(mocks.prisma.publishJob.updateMany).not.toHaveBeenCalled();
  });
  it("rejects cancellation when a worker has already claimed a publication", async () => {
    mocks.tx.publishJob.count.mockResolvedValue(1);
    await expect(cancelPost(ctx, "post")).rejects.toThrow("Publishing has already started");
    expect(mocks.tx.postVariant.updateMany).not.toHaveBeenCalled();
  });
  it("does not erase a published variant when cancelling the remaining queue", async () => {
    await cancelPost(ctx, "post");
    expect(mocks.tx.postVariant.updateMany).toHaveBeenCalledWith({
      where: { postId: "post", status: { notIn: ["PUBLISHED", "DELETED"] } },
      data: { status: "CANCELLED" },
    });
  });
  it("replaces a queued revision with a distinct job even when the timestamp is reused", async () => {
    await schedulePost(ctx, "post", when, "UTC");
    const firstKey = mocks.tx.publishJob.create.mock.calls[0]![0].data.idempotencyKey;
    await schedulePost(ctx, "post", when, "UTC");
    const secondKey = mocks.tx.publishJob.create.mock.calls[1]![0].data.idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
    expect(mocks.tx.publishJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CANCELLED" } }),
    );
  });
  it("rejects a reschedule after a worker has claimed any variant", async () => {
    mocks.tx.publishJob.count.mockResolvedValue(1);
    await expect(schedulePost(ctx, "post", when)).rejects.toThrow("Publishing has already started");
    expect(mocks.tx.publishJob.create).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("does not replace another user's newer schedule", async () => {
    mocks.tx.post.updateMany.mockResolvedValue({ count: 0 });
    await expect(schedulePost(ctx, "post", when)).rejects.toThrow("This post changed");
    expect(mocks.tx.publishJob.updateMany).not.toHaveBeenCalled();
  });
  it("never schedules a partially published post again", async () => {
    const value = post("FAILED");
    mocks.prisma.post.findFirst.mockResolvedValue({
      ...value,
      variants: [{ ...value.variants[0], externalPostId: "live-post" }],
    });
    await expect(schedulePost(ctx, "post", when)).rejects.toThrow("already published");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("keeps approval requirements in force", async () => {
    const value = post();
    mocks.prisma.post.findFirst.mockResolvedValue({
      ...value,
      variants: [
        { ...value.variants[0], socialAccount: { ...value.variants[0]!.socialAccount, requireApproval: true } },
      ],
    });
    await expect(schedulePost(ctx, "post", when)).rejects.toThrow("approved before scheduling");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("does not run a stale Redis task after the calendar cancelled its database revision", async () => {
    mocks.prisma.publishJob.findUnique.mockResolvedValue({
      id: "old-job",
      status: "QUEUED",
      postVariant: { id: "variant", postId: "post", socialAccount: {} },
    });
    mocks.prisma.publishJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(runPublishJob("old-job")).resolves.toBeUndefined();
    expect(mocks.prisma.publishJob.updateMany).toHaveBeenCalledWith({
      where: { id: "old-job", status: "QUEUED" },
      data: { status: "RUNNING" },
    });
  });
});
