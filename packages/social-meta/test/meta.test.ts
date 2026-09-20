import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "@platform/encryption";
import {
  FacebookProvider,
  InstagramProvider,
  MetaOAuth,
  handleMetaVerification,
  verifyMetaSignature,
} from "../src/index";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("webhook signature", () => {
  it("verifies X-Hub-Signature-256 over raw body", () => {
    const body = '{"object":"page","entry":[]}';
    const sig = `sha256=${hmacSha256Hex("app-secret", body)}`;
    expect(verifyMetaSignature("app-secret", body, sig)).toBe(true);
    expect(verifyMetaSignature("app-secret", body + " ", sig)).toBe(false);
    expect(verifyMetaSignature("other", body, sig)).toBe(false);
    expect(verifyMetaSignature("app-secret", body, null)).toBe(false);
    expect(verifyMetaSignature("app-secret", body, "sha1=abc")).toBe(false);
  });
  it("handles the subscribe handshake", () => {
    const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "v", "hub.challenge": "123" });
    expect(handleMetaVerification(q, "v")).toEqual({ ok: true, challenge: "123" });
    expect(handleMetaVerification(q, "wrong")).toEqual({ ok: false });
  });
});

describe("MetaOAuth", () => {
  it("discovers pages and linked Instagram accounts with page-scoped tokens", async () => {
    mockFetch((url) => {
      if (url.includes("/oauth/access_token"))
        return new Response(
          JSON.stringify({ access_token: url.includes("fb_exchange_token") ? "long" : "short", expires_in: 5184000 }),
        );
      if (url.includes("/me/accounts")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "p1",
                name: "Page One",
                access_token: "ptok1",
                instagram_business_account: { id: "ig1", username: "one" },
              },
              { id: "p2", name: "Page Two", access_token: "ptok2" },
            ],
          }),
        );
      }
      return new Response("{}", { status: 404 });
    });
    const oauth = new MetaOAuth({ clientId: "a", clientSecret: "b" });
    const { userToken, accounts } = await oauth.handleCallback("code", "https://app/cb");
    expect(userToken.accessToken).toBe("long");
    expect(accounts.map((a) => `${a.platform}:${a.externalAccountId}`)).toEqual([
      "FACEBOOK:p1",
      "INSTAGRAM:ig1",
      "FACEBOOK:p2",
    ]);
    expect(accounts[1]?.credential.accessToken).toBe("ptok1");
    expect(accounts[1]?.metadata?.facebookPageId).toBe("p1");
  });
});

describe("FacebookProvider", () => {
  it("publishes a text post to the page feed", async () => {
    const fetchMock = mockFetch((url, init) => {
      expect(url).toContain("/p1/feed");
      expect(String(init?.body)).toContain("message=Hello");
      return new Response(JSON.stringify({ id: "p1_99" }));
    });
    const fb = new FacebookProvider({ clientId: "a", clientSecret: "b" });
    const r = await fb.publish(
      { idempotencyKey: "k", text: "Hello", media: [] },
      { credential: { accessToken: "ptok", scopes: [] }, externalAccountId: "p1", accountType: "PAGE" },
    );
    expect(r.externalPostId).toBe("p1_99");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("InstagramProvider", () => {
  it("requires media", async () => {
    const ig = new InstagramProvider({ clientId: "a", clientSecret: "b" });
    const r = await ig.validatePost({ idempotencyKey: "k", text: "x", media: [] });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("MEDIA_REQUIRED");
  });
  it("flags bad aspect ratios and >30 hashtags", async () => {
    const ig = new InstagramProvider({ clientId: "a", clientSecret: "b" });
    const r = await ig.validatePost({
      idempotencyKey: "k",
      text: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "),
      media: [{ id: "m", kind: "IMAGE", mimeType: "image/jpeg", size: 1, width: 100, height: 400, url: "u" }],
    });
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["ASPECT_RATIO", "TOO_MANY_HASHTAGS"]));
  });
  it("creates a container, waits for FINISHED, then publishes", async () => {
    const calls: string[] = [];
    let polls = 0;
    mockFetch((url) => {
      calls.push(url);
      if (url.endsWith("/ig1/media")) return new Response(JSON.stringify({ id: "c1" }));
      if (url.includes("/c1?"))
        return new Response(JSON.stringify({ status_code: polls++ === 0 ? "IN_PROGRESS" : "FINISHED" }));
      if (url.endsWith("/ig1/media_publish")) return new Response(JSON.stringify({ id: "m1" }));
      if (url.includes("/m1?")) return new Response(JSON.stringify({ permalink: "https://instagram.com/p/x" }));
      return new Response("{}", { status: 404 });
    });
    const ig = new InstagramProvider({ clientId: "a", clientSecret: "b", sleep: async () => {} });
    const r = await ig.publish(
      {
        idempotencyKey: "k",
        text: "cap",
        media: [{ id: "m", kind: "IMAGE", mimeType: "image/jpeg", size: 1, url: "https://cdn/x.jpg" }],
      },
      { credential: { accessToken: "ptok", scopes: [] }, externalAccountId: "ig1", accountType: "BUSINESS" },
    );
    expect(r.externalPostId).toBe("m1");
    expect(r.externalUrl).toBe("https://instagram.com/p/x");
    expect(calls.filter((c) => c.includes("/c1?"))).toHaveLength(2);
  });
});

describe("metrics", () => {
  const ctx = { credential: { accessToken: "t", scopes: [] }, externalAccountId: "p1", accountType: "PAGE" as const };
  it("normalises Facebook post metrics from fields + insights", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            likes: { summary: { total_count: 12 } },
            comments: { summary: { total_count: 3 } },
            shares: { count: 2 },
            insights: {
              data: [
                { name: "post_impressions", values: [{ value: 500 }] },
                { name: "post_impressions_unique", values: [{ value: 420 }] },
                { name: "post_clicks", values: [{ value: 9 }] },
              ],
            },
          }),
        ),
    );
    const fb = new FacebookProvider({ clientId: "a", clientSecret: "b" });
    const m = await fb.getPostMetrics("p1_1", ctx);
    expect(m?.metrics).toEqual({ likes: 12, comments: 3, shares: 2, impressions: 500, reach: 420, clicks: 9 });
  });
  it("normalises Instagram insights and maps views to impressions", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            data: [
              { name: "views", values: [{ value: 1000 }] },
              { name: "reach", values: [{ value: 800 }] },
              { name: "saved", values: [{ value: 7 }] },
            ],
          }),
        ),
    );
    const ig = new InstagramProvider({ clientId: "a", clientSecret: "b" });
    const m = await ig.getPostMetrics("m1", { ...ctx, accountType: "BUSINESS" });
    expect(m?.metrics).toMatchObject({ impressions: 1000, reach: 800, saves: 7 });
    expect(m?.metrics.likes).toBeUndefined();
  });
  it("reads account followers", async () => {
    mockFetch(() => new Response(JSON.stringify({ followers_count: 4321 })));
    const fb = new FacebookProvider({ clientId: "a", clientSecret: "b" });
    expect((await fb.getAccountMetrics(ctx))?.metrics.followers).toBe(4321);
  });
});
