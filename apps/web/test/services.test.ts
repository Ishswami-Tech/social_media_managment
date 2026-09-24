import { describe, expect, it } from "vitest";
import { createPostInput } from "@/lib/services/posts";
import { sendMessageInput } from "@/lib/services/whatsapp";
import { targetsFor } from "@/lib/services/brand";

describe("input schemas", () => {
  it("createPostInput requires at least one variant and bounded text", () => {
    expect(createPostInput.safeParse({ masterText: "hi", variants: [] }).success).toBe(false);
    const ok = createPostInput.safeParse({ masterText: "hi", variants: [{ socialAccountId: "a" }] });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.variants[0]?.mediaAssetIds).toEqual([]);
    expect(
      createPostInput.safeParse({ masterText: "hi", variants: [{ socialAccountId: "a" }], scheduledAt: "not-a-date" })
        .success,
    ).toBe(false);
  });
  it("sendMessageInput defaults to TEXT", () => {
    const r = sendMessageInput.parse({ conversationId: "c", text: "hello" });
    expect(r.type).toBe("TEXT");
    expect(r.aiSuggested).toBe(false);
  });
  it("targetsFor applies platform limits", () => {
    const t = targetsFor(["X", "INSTAGRAM"]);
    expect(t.find((x) => x.platform === "X")?.maxLength).toBe(280);
    expect(t.find((x) => x.platform === "INSTAGRAM")?.maxLength).toBe(2200);
  });
});

describe("deleting posts", () => {
  it("refuses states where a worker may still be publishing", async () => {
    const { UNDELETABLE_STATUSES } = await import("@/lib/services/posts");
    expect(UNDELETABLE_STATUSES).toEqual(["QUEUED", "PUBLISHING"]);
    expect(UNDELETABLE_STATUSES).not.toContain("PUBLISHED");
  });
});
