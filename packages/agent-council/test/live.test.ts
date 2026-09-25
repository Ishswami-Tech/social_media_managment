import { describe, expect, it } from "vitest";
import { applyPartials, partialTextField } from "../src/live";
import type { AgentBoard, AgentSeat } from "../src/progress";

describe("partialTextField", () => {
  it("reads the text field out of a JSON answer that is still arriving", () => {
    expect(partialTextField('{"text": "Hello wor')).toBe("Hello wor");
    expect(partialTextField('{"hashtags":["a"],"text":"Done."}')).toBe("Done.");
  });
  it("decodes escapes and stops at a half-received one", () => {
    expect(partialTextField('{"text":"Line one\\nLine \\"two\\" \\u00e9')).toBe('Line one\nLine "two" é');
    expect(partialTextField('{"text":"Cut \\')).toBe("Cut ");
    expect(partialTextField('{"text":"Cut \\u00')).toBe("Cut ");
  });
  it("gives nothing before the field or when the value is not a string", () => {
    expect(partialTextField('{"hashtags":["a"], "te')).toBe("");
    expect(partialTextField('{"text": 42')).toBe("");
    expect(partialTextField("")).toBe("");
  });
});

const seat = (label: string, state: AgentSeat["state"]): AgentSeat => ({
  role: "writer",
  name: `Writer ${label}`,
  label,
  state,
  detail: "Writing…",
});

describe("applyPartials", () => {
  const board: AgentBoard = { seats: [], writers: [seat("A", "done"), seat("B", "active"), seat("C", "pending")], modelsByStage: {} };

  it("lays live text over the writer that is mid-sentence and leaves finished ones alone", () => {
    const next = applyPartials(board, {
      "writer:acc:B": { step: "writer:acc:B", label: "B", provider: "ANTHROPIC", model: "claude-haiku-4-5", text: "So far", chars: 40 },
      "writer:acc:A": { step: "writer:acc:A", label: "A", provider: "OPENAI", model: "gpt-5", text: "stale", chars: 9 },
    });
    expect(next.writers[0]).toEqual(board.writers[0]);
    expect(next.writers[1]?.draft).toBe("So far");
    expect(next.writers[1]?.streaming).toBe(true);
    expect(next.writers[1]?.modelLabel).toContain("Haiku");
    expect(next.writers[1]?.detail).toBe("6 characters so far…");
    expect(next.writers[2]?.draft).toBeUndefined();
  });

  it("says thinking while bytes arrive but no text field has started", () => {
    const next = applyPartials(board, {
      "writer:acc:C": { step: "writer:acc:C", label: "C", provider: "GOOGLE", model: "gemini-2.5-flash", text: "", chars: 12 },
    });
    expect(next.writers[2]?.state).toBe("active");
    expect(next.writers[2]?.detail).toBe("Thinking…");
  });

  it("returns the same board when there is nothing live", () => {
    expect(applyPartials(board, undefined)).toBe(board);
    expect(applyPartials(board, {})).toBe(board);
  });
});
