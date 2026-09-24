import { describe, expect, it } from "vitest";
import { estimatePerformance, textSignals } from "../src/scoring";

const STRONG_LI = [
  "I answered a WhatsApp order 11 minutes late last Tuesday. The customer had already walked to the cafe next door.",
  "",
  "Since then every order gets a reply inside two minutes, even if it is just \"got it, five minutes\".",
  "",
  "Queue at the counter: down. Repeat orders: up. Nothing else changed.",
  "",
  "How fast do you reply to orders today?",
].join("\n");

describe("textSignals", () => {
  it("reads hook type, paragraphs, CTA and clichés from the text", () => {
    const s = textSignals(STRONG_LI);
    expect(s.hookType).toBe("story");
    expect(s.paragraphs).toBe(4);
    expect(s.ctaType).toBe("question");
    expect(s.cliches).toEqual([]);
    expect(textSignals("3 things I learned:\n\nUnlock growth with our game-changer.\n\nSign up today").hookType).toBe("number");
    expect(textSignals("Unlock growth with our game-changer.\n\nSign up today").cliches).toEqual(["game-changer", "unlock"]);
    expect(textSignals("Plain statement.\n\nVisit https://example.com").ctaType).toBe("link");
  });
});

describe("estimatePerformance", () => {
  it("rates a native, well-structured LinkedIn post as good and explains why", () => {
    const estimate = estimatePerformance({ text: STRONG_LI, hashtags: ["#cafes", "#whatsapp"], platform: "LINKEDIN" });
    expect(["good", "strong"]).toContain(estimate.band);
    expect(estimate.score).toBeGreaterThanOrEqual(62);
    expect(estimate.strengths).toContain("Short first line that survives the fold");
    expect(estimate.strengths).toContain("Short paragraphs that read well on a phone");
    expect(estimate.strengths).toContain("Ends with an invitation to reply");
    expect(estimate.historyWeight).toBe(0);
  });

  it("penalises a wall of clichés with no call to action and too many hashtags", () => {
    const text =
      "In today's fast-paced world we are excited to announce a game-changer that will unlock synergy and elevate your cutting-edge workflows to revolutionize everything you do every single day without any breaks or line breaks at all so it just keeps going and going, and then keeps going some more because nobody on the team wanted to press return even once while writing this very long announcement.";
    const estimate = estimatePerformance({ text, hashtags: ["#a", "#b", "#c", "#d", "#e"], platform: "LINKEDIN" });
    expect(estimate.band).toBe("low");
    expect(estimate.improvements.some((i) => i.startsWith("Reads as generic"))).toBe(true);
    expect(estimate.improvements.some((i) => i.includes("No clear call to action"))).toBe(true);
    expect(estimate.improvements.some((i) => i.includes("5 hashtags"))).toBe(true);
    expect(estimate.improvements.some((i) => i.includes("line breaks"))).toBe(true);
  });

  it("rewards what the account's own history says works and reports the history weight", () => {
    const brain = { performance: { sampleSize: 12, confidence: 0.7, bestHooks: ["story"], bestCtas: ["question"] } };
    const withHistory = estimatePerformance({ text: STRONG_LI, hashtags: [], platform: "LINKEDIN", brain });
    const without = estimatePerformance({ text: STRONG_LI, hashtags: [], platform: "LINKEDIN" });
    expect(withHistory.score).toBeGreaterThan(without.score);
    expect(withHistory.historyWeight).toBe(0.7);
    expect(withHistory.strengths.some((s) => s.includes("has worked for this account"))).toBe(true);
  });

  it("blends in the blind judge when a run had one", () => {
    const strongJudge = estimatePerformance({ text: STRONG_LI, hashtags: [], platform: "LINKEDIN", judgeScore: 54 });
    const weakJudge = estimatePerformance({ text: STRONG_LI, hashtags: [], platform: "LINKEDIN", judgeScore: 20 });
    expect(strongJudge.score).toBeGreaterThan(weakJudge.score);
    expect(strongJudge.strengths.some((s) => s.includes("blind judge"))).toBe(true);
    expect(weakJudge.improvements.some((s) => s.includes("blind judge"))).toBe(true);
  });

  it("flags forbidden language from the Account Brain", () => {
    const estimate = estimatePerformance({
      text: "We ship synergy every week.\n\nWhat would you change first?",
      hashtags: [],
      platform: "LINKEDIN",
      brain: { voice: { forbiddenLanguage: ["synergy"] } },
    });
    expect(estimate.improvements.some((i) => i.includes('"synergy"'))).toBe(true);
  });
});
