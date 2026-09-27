import { describe, expect, it } from "vitest";
import { trustedOrigins } from "@/lib/auth";

/**
 * A deployment is usually reachable by more than one name: the platform's own
 * hostname and a custom domain. Sign-in from a name the server does not trust
 * is refused, so the list has to cover every name the app answers on.
 */
describe("the origins sign-in is allowed from", () => {
  it("always trusts the app's own URL", () => {
    expect(trustedOrigins("https://social.example.com", undefined)).toEqual(["https://social.example.com"]);
  });

  it("adds the extra origins, trimmed and without a trailing path", () => {
    expect(trustedOrigins("https://a.example.com", " https://b.example.com/ , https://c.example.com/login ")).toEqual([
      "https://a.example.com",
      "https://b.example.com",
      "https://c.example.com",
    ]);
  });

  it("keeps each origin once", () => {
    expect(trustedOrigins("https://a.example.com", "https://a.example.com,https://a.example.com/x")).toEqual(["https://a.example.com"]);
  });

  it("ignores entries that are not URLs rather than refusing to start", () => {
    expect(trustedOrigins("https://a.example.com", "not a url,,https://b.example.com")).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("keeps the port, because a local origin is not the same without it", () => {
    expect(trustedOrigins("http://localhost:3005", undefined)).toEqual(["http://localhost:3005"]);
  });
});
