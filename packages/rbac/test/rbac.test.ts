import { describe, expect, it } from "vitest";
import { assertCan, can, canAssignRole, capabilitiesFor, ForbiddenError } from "../src/index";

describe("permission matrix", () => {
  it("super admin manages the platform; no org role does", () => {
    expect(can({ userId: "u", isSuperAdmin: true }, "platform:manage")).toBe(true);
    expect(can({ userId: "u", role: "OWNER" }, "platform:manage")).toBe(false);
  });

  it("super admin has support access to org capabilities but not billing/ownership", () => {
    const sa = { userId: "u", isSuperAdmin: true };
    expect(can(sa, "org:settings")).toBe(true);
    expect(can(sa, "content:publish")).toBe(true);
    expect(can(sa, "org:billing")).toBe(false);
    expect(can(sa, "org:transfer_ownership")).toBe(false);
    expect(can(sa, "org:settings", { allowSuperAdminSupport: false })).toBe(false);
  });

  it("non-members have no access", () => {
    expect(can({ userId: "u" }, "accounts:view")).toBe(false);
  });

  it("owner has full control, admin cannot transfer ownership or manage billing", () => {
    expect(can({ userId: "u", role: "OWNER" }, "org:transfer_ownership")).toBe(true);
    expect(can({ userId: "u", role: "ADMIN" }, "org:transfer_ownership")).toBe(false);
    expect(can({ userId: "u", role: "ADMIN" }, "org:billing")).toBe(false);
    expect(can({ userId: "u", role: "ADMIN" }, "org:members")).toBe(true);
  });

  it("editor can create but not approve; approver can approve but not create", () => {
    const editor = { userId: "u", role: "EDITOR" as const };
    const approver = { userId: "u", role: "APPROVER" as const };
    expect(can(editor, "content:create")).toBe(true);
    expect(can(editor, "content:approve")).toBe(false);
    expect(can(approver, "content:approve")).toBe(true);
    expect(can(approver, "content:create")).toBe(false);
  });

  it("publish is configurable for editors and defaults to off", () => {
    const editor = { userId: "u", role: "EDITOR" as const };
    expect(can(editor, "content:publish")).toBe(false);
    expect(can(editor, "content:publish", { overrides: { EDITOR: ["content:publish"] } })).toBe(true);
  });

  it("viewer is read-only", () => {
    const viewer = { userId: "u", role: "VIEWER" as const };
    expect(can(viewer, "analytics:view")).toBe(true);
    expect(can(viewer, "content:create")).toBe(false);
    expect(can(viewer, "accounts:connect")).toBe(false);
    expect(capabilitiesFor(viewer)).toEqual(["accounts:view", "whatsapp:view", "analytics:view"]);
  });

  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan({ userId: "u", role: "VIEWER" }, "content:publish")).toThrow(ForbiddenError);
  });
});

describe("role assignment", () => {
  it("owner can assign any role including transferring ownership", () => {
    expect(canAssignRole({ userId: "u", role: "OWNER" }, "OWNER")).toBe(true);
    expect(canAssignRole({ userId: "u", role: "OWNER" }, "VIEWER")).toBe(true);
  });
  it("admin cannot make owners", () => {
    expect(canAssignRole({ userId: "u", role: "ADMIN" }, "OWNER")).toBe(false);
    expect(canAssignRole({ userId: "u", role: "ADMIN" }, "ADMIN")).toBe(true);
  });
  it("manager without the members override cannot assign; with it only below manager", () => {
    const mgr = { userId: "u", role: "MANAGER" as const };
    expect(canAssignRole(mgr, "EDITOR")).toBe(false);
    const opts = { overrides: { MANAGER: ["org:members" as const] } };
    expect(canAssignRole(mgr, "EDITOR", opts)).toBe(true);
    expect(canAssignRole(mgr, "MANAGER", opts)).toBe(false);
    expect(canAssignRole(mgr, "ADMIN", opts)).toBe(false);
  });
  it("editors cannot manage members at all", () => {
    expect(canAssignRole({ userId: "u", role: "EDITOR" }, "VIEWER")).toBe(false);
  });
});
