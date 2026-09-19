import { describe, expect, it } from "vitest";
import { hasOrganizationFilter, TENANT_MODELS } from "../src/tenant";

describe("hasOrganizationFilter", () => {
  it("accepts direct organizationId filters", () => {
    expect(hasOrganizationFilter({ organizationId: "org_1" })).toBe(true);
    expect(hasOrganizationFilter({ organizationId: { equals: "org_1" } })).toBe(true);
    expect(hasOrganizationFilter({ organizationId: { in: ["a", "b"] } })).toBe(true);
  });
  it("accepts organizationId nested in AND", () => {
    expect(hasOrganizationFilter({ AND: [{ status: "DRAFT" }, { organizationId: "o" }] })).toBe(true);
  });
  it("requires every OR branch to be scoped", () => {
    expect(hasOrganizationFilter({ OR: [{ organizationId: "o" }, { status: "DRAFT" }] })).toBe(false);
    expect(hasOrganizationFilter({ OR: [{ organizationId: "o" }, { organizationId: "p" }] })).toBe(true);
  });
  it("rejects unscoped or empty filters", () => {
    expect(hasOrganizationFilter(undefined)).toBe(false);
    expect(hasOrganizationFilter({})).toBe(false);
    expect(hasOrganizationFilter({ organizationId: { in: [] } })).toBe(false);
    expect(hasOrganizationFilter({ id: "post_1" })).toBe(false);
  });
  it("guards every organization-owned model", () => {
    for (const m of ["Post", "SocialAccount", "Conversation", "Contact", "MediaAsset", "AIUsage"]) {
      expect(TENANT_MODELS.has(m)).toBe(true);
    }
  });
});
