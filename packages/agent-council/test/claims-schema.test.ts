import { describe, expect, it } from "vitest";
import { ClaimsOutputSchema } from "../src/stages/research";

describe("ClaimsOutputSchema", () => {
  it("treats null source fields as absent instead of rejecting the whole answer", () => {
    const parsed = ClaimsOutputSchema.parse({
      claims: [
        { statement: "Queues shrink", sourceUrl: null, sourceTitle: null, evidence: null, confidence: null, status: null },
        { statement: "Orders rise", sourceUrl: "https://x", sourceTitle: "X", evidence: "q", confidence: 0.9, status: "SUPPORTED" },
      ],
    });
    expect(parsed.claims[0]).toEqual({ statement: "Queues shrink", confidence: 0.5, status: "UNVERIFIED" });
    expect(parsed.claims[1]?.status).toBe("SUPPORTED");
    expect(ClaimsOutputSchema.parse({ claims: null }).claims).toEqual([]);
  });
});
