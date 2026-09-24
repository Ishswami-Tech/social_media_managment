import { describe, expect, it } from "vitest";
import { stripInlineClaimIds } from "../src/stages/shared";

const CLAIMS = [{ id: "cmuf6cwq3000a" }, { id: "cl_2" }];

describe("stripInlineClaimIds", () => {
  it("removes bracketed, parenthesised and grouped claim ids and tidies the punctuation", () => {
    expect(stripInlineClaimIds("70% expect instant replies [cmuf6cwq3000a]. Every minute counts (cl_2).", CLAIMS)).toBe(
      "70% expect instant replies. Every minute counts.",
    );
    expect(stripInlineClaimIds("Both hold [cmuf6cwq3000a, cl_2] today.", CLAIMS)).toBe("Both hold today.");
  });

  it("removes a bare id but leaves ordinary words and unknown ids alone", () => {
    expect(stripInlineClaimIds("Source cl_2 says so.\n\nNext line cl_99 stays.", CLAIMS)).toBe("Source says so.\n\nNext line cl_99 stays.");
  });

  it("is a no-op without claims", () => {
    const text = "Nothing to do here [cl_2].";
    expect(stripInlineClaimIds(text, [])).toBe(text);
  });
});
