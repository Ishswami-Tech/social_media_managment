import { describe, expect, it } from "vitest";
import { encodeContext, stringify } from "../src/stages/shared";

/**
 * Context the model reads is TOON; anything it writes stays JSON. The point of
 * the change is fewer tokens on uniform data, so the tests measure that rather
 * than pinning the exact bytes of someone else's format.
 */
const brain = {
  identity: { brand: "Acme", industry: "Coffee" },
  humanFeedback: {
    preferences: [
      { text: "Shorter, end with a question", weight: 1, source: "explicit", at: "2026-09-24T17:48:24.105Z" },
      { text: "Open on a concrete moment", weight: 0.9, source: "edit", at: "2026-09-24T16:24:51.252Z" },
      { text: "No hashtag labels", weight: 0.81, source: "rejection", at: "2026-09-24T16:19:31.706Z" },
    ],
  },
};

describe("context sent to a model", () => {
  it("says what the format is, so the model never has to guess", () => {
    expect(encodeContext(brain).split("\n")[0]).toMatch(/^# TOON format:/);
  });

  it("is smaller than the pretty JSON it replaced", () => {
    expect(encodeContext(brain).length).toBeLessThan(stringify(brain).length);
  });

  it("drops the repeated keys of a uniform array, which is where the saving comes from", () => {
    const encoded = encodeContext(brain);
    // Three preferences, one header naming the fields once instead of three times.
    expect(encoded).toContain("[3]{");
    expect(encoded.match(/weight/g)).toHaveLength(1);
    expect(stringify(brain).match(/weight/g)).toHaveLength(3);
  });

  it("keeps every value the model needs to read", () => {
    const encoded = encodeContext(brain);
    for (const needed of ["Acme", "Coffee", "Shorter, end with a question", "No hashtag labels", "0.81"]) {
      expect(encoded).toContain(needed);
    }
  });

  it("handles the empty and awkward shapes a brain can arrive in", () => {
    expect(() => encodeContext({})).not.toThrow();
    expect(() => encodeContext({ voice: null, content: undefined, stories: [] })).not.toThrow();
    expect(encodeContext({ note: "a line\nand another" })).toContain("a line");
  });

  it("leaves stringify alone for anything that must stay JSON", () => {
    expect(JSON.parse(stringify({ a: 1 }))).toEqual({ a: 1 });
  });
});
