import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers: cookie ? { cookie } : {} });

describe("proxy", () => {
  it("lets public routes through without a session", () => {
    for (const p of [
      "/login",
      "/register",
      "/api/auth/sign-in/email",
      "/api/webhooks/meta",
      "/api/health",
      "/api/oauth/meta/callback",
    ]) {
      expect(proxy(req(p)).headers.get("location")).toBeNull();
    }
  });
  it("redirects anonymous page requests to /login with a next param", () => {
    const res = proxy(req("/posts/abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fposts%2Fabc");
  });
  it("returns 401 JSON for anonymous API requests", async () => {
    const res = proxy(req("/api/posts"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });
  it("passes requests that carry a session cookie", () => {
    const res = proxy(req("/dashboard", "better-auth.session_token=abc.def"));
    expect(res.headers.get("location")).toBeNull();
  });
});
