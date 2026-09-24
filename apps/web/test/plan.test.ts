import { describe, expect, it } from "vitest";
import { funnelFor, planPrompt, spreadDates } from "../lib/agent/plan";

describe("spreadDates", () => {
  it("spreads the requested number of posts over the period on weekdays", () => {
    // 2026-09-28 is a Monday.
    const dates = spreadDates("2026-09-28", 28, 3);
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe("2026-09-28");
    for (const d of dates) {
      const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
      expect(weekday).not.toBe(0);
      expect(weekday).not.toBe(6);
    }
    expect([...dates].sort()).toEqual(dates);
  });

  it("keeps weekends when posting daily and never returns duplicates", () => {
    const daily = spreadDates("2026-10-03", 7, 7);
    expect(daily).toHaveLength(7);
    expect(new Set(daily).size).toBe(7);
  });
});

describe("funnelFor", () => {
  it("moves from awareness to trust to offer across the month", () => {
    const stages = Array.from({ length: 12 }, (_, i) => funnelFor(i, 12));
    expect(stages.slice(0, 5)).toEqual(["awareness", "awareness", "awareness", "awareness", "awareness"]);
    expect(stages.slice(5, 9)).toEqual(["trust", "trust", "trust", "trust"]);
    expect(stages.slice(9)).toEqual(["offer", "offer", "offer"]);
    expect(funnelFor(0, 1)).toBe("offer");
  });
});

describe("planPrompt", () => {
  it("lists the slots with their funnel role and the story bank", () => {
    const prompt = planPrompt({
      theme: "WhatsApp ordering for cafes",
      platforms: ["LINKEDIN"],
      slots: [
        { date: "2026-09-28", funnel: "awareness" },
        { date: "2026-10-05", funnel: "offer" },
      ],
      stories: [{ title: "The Tuesday queue", text: "Queue hit 14 people; now 5." }],
      brand: { name: "Cafe Tools", tone: "direct" },
    });
    expect(prompt).toContain("- 2026-09-28 (awareness)");
    expect(prompt).toContain("- 2026-10-05 (offer)");
    expect(prompt).toContain("The Tuesday queue: Queue hit 14 people; now 5.");
    expect(prompt).toContain("Cafe Tools · tone: direct");
    expect(planPrompt({ theme: "t", platforms: ["X"], slots: [], stories: [] })).toContain("(none recorded yet)");
  });
});
