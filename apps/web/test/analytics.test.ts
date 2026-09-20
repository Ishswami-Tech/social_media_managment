import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/services/analytics";

describe("toCsv", () => {
  it("writes a header and escapes quotes, commas, newlines and formulas", () => {
    const csv = toCsv(
      [
        {
          postId: "p1",
          title: 'Hello, "world"',
          platform: "LINKEDIN",
          impressions: 10,
          publishedAt: new Date("2026-01-01T00:00:00Z"),
        },
        { postId: "p2", title: "=SUM(A1)", platform: "X", impressions: undefined },
      ],
      ["postId", "title", "platform", "impressions", "publishedAt"],
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("postId,title,platform,impressions,publishedAt");
    expect(lines[1]).toBe('p1,"Hello, ""world""",LINKEDIN,10,2026-01-01T00:00:00.000Z');
    expect(lines[2]).toBe("p2,'=SUM(A1),X,,");
  });
});
