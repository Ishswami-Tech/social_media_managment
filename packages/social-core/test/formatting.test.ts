import { describe, expect, it } from "vitest";
import {
  extractHashtags,
  plainTextToRichDoc,
  richDocToPlainText,
  tokenize,
  truncateForFeed,
  unicodeBold,
  unicodeItalic,
} from "../src/formatting";

describe("unicode styles", () => {
  it("maps ASCII letters and digits to bold sans-serif", () => {
    expect(unicodeBold("Ab1")).toBe("𝗔𝗯𝟭");
    expect(unicodeItalic("Ab")).toBe("𝘈𝘣");
    expect(unicodeBold("é #x")).toBe("é #𝘅");
  });
});

describe("richDocToPlainText", () => {
  it("serialises paragraphs, marks, breaks and lists", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Big " },
            { type: "text", text: "news", marks: [{ type: "bold" }] },
            { type: "hardBreak" },
            { type: "text", text: "today" },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "two", marks: [{ type: "italic" }] }] }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "#launch #coffee" }] },
      ],
    };
    expect(richDocToPlainText(doc)).toBe("Big 𝗻𝗲𝘄𝘀\ntoday\n\n• one\n• 𝘵𝘸𝘰\n\n#launch #coffee");
  });
  it("handles empty documents", () => {
    expect(richDocToPlainText(null)).toBe("");
    expect(richDocToPlainText({ type: "doc", content: [] })).toBe("");
  });
});

describe("plainTextToRichDoc", () => {
  it("round-trips plain paragraphs, line breaks and bullet lists", () => {
    const text = "Hello\nworld\n\n• a\n• b\n\nBye";
    expect(richDocToPlainText(plainTextToRichDoc(text))).toBe(text);
  });
});

describe("tokenize", () => {
  it("finds hashtags, mentions, links and newlines", () => {
    const segs = tokenize("Go #Coffee with @ada at https://x.io/a\nnow");
    expect(segs.map((s) => s.kind)).toEqual(["text", "hashtag", "text", "mention", "text", "link", "newline", "text"]);
    expect(extractHashtags("#a #b #a")).toEqual(["#a", "#b"]);
  });
});

describe("truncateForFeed", () => {
  it("cuts after three lines or 210 characters at a word boundary", () => {
    expect(truncateForFeed("a\nb\nc\nd")).toEqual({ visible: "a\nb\nc", truncated: true });
    const long = "word ".repeat(60).trim();
    const r = truncateForFeed(long);
    expect(r.truncated).toBe(true);
    expect(r.visible.length).toBeLessThanOrEqual(210);
    expect(r.visible.endsWith("word")).toBe(true);
    expect(truncateForFeed("short")).toEqual({ visible: "short", truncated: false });
  });
});
