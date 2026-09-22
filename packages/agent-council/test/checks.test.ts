import { describe, expect, it } from "vitest";
import { runChecks } from "../src/checks";
import { brain, capabilities, checkInput, supportedClaim } from "./helpers/fixtures";

const codes = (input: Parameters<typeof runChecks>[0]) => runChecks(input).issues.map((i) => i.code);

describe("checks: length", () => {
  it("passes a post inside the platform limit", () => {
    const result = runChecks(checkInput());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("fails a post longer than the platform limit, counting hashtags that are not in the text", () => {
    const input = checkInput({ text: "a".repeat(95), hashtags: ["#bbbb"], capabilities: capabilities({ text: { maxLength: 99 } }) });
    expect(codes(input)).toContain("length");
    expect(runChecks(input).ok).toBe(false);
  });

  it("fails an empty post", () => {
    expect(codes(checkInput({ text: "   ", hashtags: [] }))).toContain("empty");
  });
});

describe("checks: urls", () => {
  it("allows a URL that is a claim source", () => {
    expect(codes(checkInput({ text: "Full data: https://roasthouse.example/report" }))).toEqual([]);
  });

  it("allows a URL that appears in the campaign brief", () => {
    expect(codes(checkInput({ text: "See https://roasthouse.example/report for the method.", claims: [] }))).toEqual([]);
  });

  it("fails a URL that is neither a claim source nor in the brief", () => {
    expect(codes(checkInput({ text: "Grab it at https://unknown.example/deal" }))).toContain("url_unknown");
  });

  it("fails a non-http(s) URL", () => {
    expect(codes(checkInput({ text: "Download via ftp://files.example/report" }))).toContain("url_scheme");
  });
});

describe("checks: pii", () => {
  it("passes when no contact details appear", () => {
    expect(codes(checkInput({ text: "Tell us how you brew." }))).toEqual([]);
  });

  it("fails an email address that is not in the brief", () => {
    expect(codes(checkInput({ text: "Write to sales@roasthouse.example today." }))).toContain("pii_email");
  });

  it("fails a phone number that is not in the brief", () => {
    expect(codes(checkInput({ text: "Call us on 415-555-2671 to talk shop." }))).toContain("pii_phone");
  });

  it("allows an email that the brief itself contains", () => {
    const brief = { ...checkInput().brief, notes: "Contact hello@roasthouse.example" };
    expect(codes(checkInput({ text: "Write to hello@roasthouse.example.", brief }))).toEqual([]);
  });
});

describe("checks: banned phrases and forbidden topics", () => {
  it("passes a post that avoids the Account Brain's forbidden language", () => {
    expect(codes(checkInput({ text: "A practical change for small roasters." }))).toEqual([]);
  });

  it("fails a post using forbidden language", () => {
    expect(codes(checkInput({ text: "This is a game-changer for roasters." }))).toContain("banned_phrase");
  });

  it("fails a post touching a forbidden topic", () => {
    expect(codes(checkInput({ text: "Coffee, politics and everything between." }))).toContain("forbidden_topic");
  });

  it("does not match a forbidden phrase inside a longer word", () => {
    const input = checkInput({ text: "Our synergybot is fine.", brain: brain({ voice: { forbiddenLanguage: ["synergy"] } }) });
    expect(codes(input)).toEqual([]);
  });
});

describe("checks: hashtags", () => {
  const tags = (n: number, prefix = "tag") => Array.from({ length: n }, (_, i) => `#${prefix}${i}`);

  it("allows up to 30 hashtags on Instagram", () => {
    const input = checkInput({ platform: "INSTAGRAM", text: "Cold brew season.", claims: [], hashtags: tags(30) });
    expect(runChecks(input).ok).toBe(true);
  });

  it("fails more than 30 hashtags on Instagram", () => {
    const input = checkInput({ platform: "INSTAGRAM", text: "Cold brew season.", claims: [], hashtags: tags(31) });
    expect(codes(input)).toContain("hashtags_limit");
    expect(runChecks(input).ok).toBe(false);
  });

  it("warns but does not fail above 5 hashtags on LinkedIn", () => {
    const input = checkInput({ text: "Cold brew season.", claims: [], hashtags: tags(6) });
    const result = runChecks(input);
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => [i.code, i.severity])).toContainEqual(["hashtags_limit", "warning"]);
  });

  it("fails more than 10 hashtags on other platforms", () => {
    const input = checkInput({ platform: "FACEBOOK", text: "Cold brew season.", claims: [], hashtags: tags(11) });
    expect(codes(input)).toContain("hashtags_limit");
  });

  it("counts hashtags written inside the text", () => {
    const input = checkInput({ platform: "FACEBOOK", text: `Cold brew season. ${tags(11).join(" ")}`, claims: [], hashtags: [] });
    expect(codes(input)).toContain("hashtags_limit");
  });
});

describe("checks: duplicates", () => {
  const text = "Cold brew is the fastest growing drink on our menu and our roasters keep asking about it.";

  it("passes when nothing recent is similar", () => {
    const input = checkInput({ text, claims: [], recentTexts: ["Espresso machines need descaling every month, here is our routine."] });
    expect(codes(input)).toEqual([]);
  });

  it("fails a near-duplicate of a recently published post", () => {
    const input = checkInput({ text, claims: [], recentTexts: [`${text} Let us know.`] });
    expect(codes(input)).toContain("duplicate");
  });
});

describe("checks: claims", () => {
  it("passes a factual sentence backed by a SUPPORTED claim", () => {
    const input = checkInput({ text: "Cold brew sales grew 20% across Europe last year." });
    expect(codes(input)).toEqual([]);
  });

  it("fails a number that no SUPPORTED claim backs", () => {
    const input = checkInput({ text: "Our roastery revenue tripled to $4 million." });
    expect(codes(input)).toContain("unsupported_claim");
  });

  it("fails a sentence citing a study with no SUPPORTED claim", () => {
    const input = checkInput({ text: "A recent study proves oat milk wins on taste." });
    expect(codes(input)).toContain("unsupported_claim");
  });

  it("does not accept an UNVERIFIED claim as backing", () => {
    const input = checkInput({
      text: "Oat milk will overtake dairy by 40% in specialty cafes.",
      claims: [{ ...supportedClaim, status: "UNVERIFIED" }],
    });
    expect(codes(input)).toContain("unsupported_claim");
  });

  it("passes a post that states no numbers at all", () => {
    expect(codes(checkInput({ text: "Ask your roaster what they brew in summer.", claims: [] }))).toEqual([]);
  });
});

describe("checks: platform rules", () => {
  it("fails an Instagram post without media", () => {
    const input = checkInput({
      platform: "INSTAGRAM",
      text: "Cold brew season.",
      claims: [],
      capabilities: capabilities({ media: { kinds: ["IMAGE"], maxCount: 10, required: true } }),
      hasMedia: false,
    });
    expect(codes(input)).toContain("media_required");
  });

  it("passes an Instagram post that has a media concept", () => {
    const input = checkInput({
      platform: "INSTAGRAM",
      text: "Cold brew season.",
      claims: [],
      capabilities: capabilities({ media: { kinds: ["IMAGE"], maxCount: 10, required: true } }),
      hasMedia: true,
    });
    expect(runChecks(input).ok).toBe(true);
  });

  it("fails an X post over 280 characters", () => {
    const input = checkInput({ platform: "X", text: "a".repeat(281), claims: [], hashtags: [] });
    expect(codes(input)).toContain("x_length");
  });

  it("passes an X post inside 280 characters", () => {
    const input = checkInput({ platform: "X", text: "a".repeat(200), claims: [], hashtags: [] });
    expect(runChecks(input).ok).toBe(true);
  });
});
