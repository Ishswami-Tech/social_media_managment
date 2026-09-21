import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LINKEDIN_API_VERSION, LinkedInProvider } from "../src/index";

const provider = new LinkedInProvider({ clientId: "cid", clientSecret: "sec" });

afterEach(() => vi.unstubAllGlobals());

function mockFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    for (const [prefix, handler] of Object.entries(routes)) if (url.startsWith(prefix)) return handler(init);
    return new Response(JSON.stringify({ message: `unmocked ${url}` }), { status: 500 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("LinkedInProvider", () => {
  it("builds an authorization URL with state and scopes", async () => {
    const { url } = await provider.getAuthorizationUrl("https://app/cb", "st4te");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(u.searchParams.get("state")).toBe("st4te");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("scope")).toContain("w_member_social");
  });

  it("exchanges the code and discovers the member profile", async () => {
    mockFetch({
      "https://www.linkedin.com/oauth/v2/accessToken": () =>
        new Response(
          JSON.stringify({
            access_token: "tok",
            expires_in: 3600,
            refresh_token: "ref",
            refresh_token_expires_in: 86400,
          }),
        ),
      "https://api.linkedin.com/v2/userinfo": () =>
        new Response(JSON.stringify({ sub: "abc", name: "Ada", picture: "https://p" })),
    });
    const [acct] = await provider.handleCallback({ code: "c", state: "s", redirectUri: "https://app/cb" });
    expect(acct?.externalAccountId).toBe("abc");
    expect(acct?.accountType).toBe("PROFILE");
    expect(acct?.credential.accessToken).toBe("tok");
    expect(acct?.credential.refreshToken).toBe("ref");
    expect(acct?.credential.expiresAt).toBeInstanceOf(Date);
  });

  it("publishes a text post and reads the id from the x-restli-id header", async () => {
    const fetchMock = mockFetch({
      "https://api.linkedin.com/rest/posts": (init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.author).toBe("urn:li:person:abc");
        expect(body.commentary).toBe("Hello");
        return new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:123" } });
      },
    });
    const res = await provider.publish(
      { idempotencyKey: "k", text: "Hello", media: [] },
      { credential: { accessToken: "tok", scopes: [] }, externalAccountId: "abc", accountType: "PROFILE" },
    );
    expect(res.externalPostId).toBe("urn:li:share:123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["linkedin-version"]).toBe(DEFAULT_LINKEDIN_API_VERSION);
    expect(DEFAULT_LINKEDIN_API_VERSION).toMatch(/^\d{6}$/);
  });

  it("sends a configured LinkedIn-Version header instead of the default", async () => {
    const fetchMock = mockFetch({
      "https://api.linkedin.com/rest/posts": () =>
        new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:9" } }),
    });
    const custom = new LinkedInProvider({ clientId: "cid", clientSecret: "sec", apiVersion: "202701" });
    await custom.publish(
      { idempotencyKey: "k", text: "Hello", media: [] },
      { credential: { accessToken: "tok", scopes: [] }, externalAccountId: "abc", accountType: "PROFILE" },
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["linkedin-version"]).toBe("202701");
  });

  it("deletes a published post and treats an already-missing post as deleted", async () => {
    const fetchMock = mockFetch({
      "https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3A123": (init) =>
        new Response(null, { status: init?.method === "DELETE" ? 204 : 200 }),
      "https://api.linkedin.com/rest/posts/urn%3Ali%3Ashare%3Agone": () =>
        new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
    });
    const ctx = { credential: { accessToken: "tok", scopes: [] }, externalAccountId: "abc", accountType: "PROFILE" as const };
    await expect(provider.deletePost("urn:li:share:123", ctx)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE");
    await expect(provider.deletePost("urn:li:share:gone", ctx)).resolves.toBeUndefined();
  });

  it("maps a 401 to a non-retryable AUTH_EXPIRED error", async () => {
    mockFetch({
      "https://api.linkedin.com/rest/posts": () =>
        new Response(JSON.stringify({ message: "expired" }), { status: 401 }),
    });
    await expect(
      provider.publish(
        { idempotencyKey: "k", text: "x", media: [] },
        { credential: { accessToken: "t", scopes: [] }, externalAccountId: "a", accountType: "PROFILE" },
      ),
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED", retryable: false });
  });

  it("refuses to refresh without a refresh token", async () => {
    await expect(
      provider.refreshToken({
        credential: { accessToken: "t", scopes: [] },
        externalAccountId: "a",
        accountType: "PROFILE",
      }),
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
  });

  it("validates LinkedIn-specific document rules", async () => {
    const r = await provider.validatePost({
      idempotencyKey: "k",
      text: "x",
      media: [
        { id: "d", kind: "DOCUMENT", mimeType: "application/pdf", size: 10, url: "u" },
        { id: "i", kind: "IMAGE", mimeType: "image/png", size: 10, url: "u" },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("DOCUMENT_ALONE");
  });
});

describe("metrics", () => {
  it("returns null for member profiles (LinkedIn exposes no member stats)", async () => {
    expect(
      await provider.getPostMetrics("urn:li:share:1", {
        credential: { accessToken: "t", scopes: [] },
        externalAccountId: "abc",
        accountType: "PROFILE",
      }),
    ).toBeNull();
  });
  it("normalises organization share statistics", async () => {
    mockFetch({
      "https://api.linkedin.com/rest/organizationalEntityShareStatistics": () =>
        new Response(
          JSON.stringify({
            elements: [
              {
                totalShareStatistics: {
                  impressionCount: 900,
                  uniqueImpressionsCount: 700,
                  likeCount: 30,
                  commentCount: 4,
                  shareCount: 6,
                  clickCount: 55,
                },
              },
            ],
          }),
        ),
    });
    const m = await provider.getPostMetrics("urn:li:share:1", {
      credential: { accessToken: "t", scopes: [] },
      externalAccountId: "42",
      accountType: "ORGANIZATION",
    });
    expect(m?.metrics).toEqual({ impressions: 900, reach: 700, likes: 30, comments: 4, shares: 6, clicks: 55 });
  });
});
