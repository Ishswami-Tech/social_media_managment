import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ForbiddenError } from "@platform/rbac";
import { InvalidTransitionError } from "@platform/types";
import { ProviderError } from "@platform/social-core";
import { AIError } from "@platform/ai-core";
import { ApiError, errorResponse, parseBody } from "@/lib/api";

describe("errorResponse", () => {
  it("maps domain errors to HTTP statuses without leaking internals", async () => {
    expect(errorResponse(new ApiError(404, "Post not found", "not_found")).status).toBe(404);
    expect(errorResponse(new ForbiddenError("content:publish")).status).toBe(403);
    expect(errorResponse(new InvalidTransitionError("PUBLISHED", "DRAFT")).status).toBe(409);
    expect(errorResponse(new ProviderError("expired", "AUTH_EXPIRED", false, 401)).status).toBe(400);
    expect(errorResponse(new ProviderError("down", "PROVIDER_UNAVAILABLE", true, 503)).status).toBe(502);
    expect(errorResponse(new AIError("bad key", "AUTH", false)).status).toBe(400);
    const internal = errorResponse(new Error("secret database detail"));
    expect(internal.status).toBe(500);
    expect(JSON.stringify(await internal.json())).not.toContain("secret database detail");
  });

  it("returns 400 with details for validation errors", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ name: 1 }),
      headers: { "content-type": "application/json" },
    });
    const err = await parseBody(req, z.object({ name: z.string() })).catch((e) => e);
    const res = errorResponse(err);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation");
  });

  it("rejects non-JSON bodies", async () => {
    const req = new Request("http://x", { method: "POST", body: "not json" });
    await expect(parseBody(req, z.object({}))).rejects.toMatchObject({ status: 400 });
  });
});
