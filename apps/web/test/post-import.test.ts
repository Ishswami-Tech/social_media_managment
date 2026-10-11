import { describe, expect, it } from "vitest";
import { parsePostCsv } from "@/lib/post-import";

describe("content plan CSV", () => {
  it("reads spreadsheet BOM, quoted commas, multiline captions and escaped quotes", () => {
    const rows = parsePostCsv(
      '\uFEFFtitle,text,scheduled_at,tags\r\nLaunch,"Hello, world!\nSay ""hello"".",2026-11-01T09:00:00+05:30,one|two\r\n',
    );
    expect(rows).toEqual([
      {
        title: "Launch",
        text: 'Hello, world!\nSay "hello".',
        scheduledAt: "2026-11-01T09:00:00+05:30",
        tags: ["one", "two"],
      },
    ]);
  });
  it("accepts unscheduled captions and ignores blank lines", () => {
    expect(parsePostCsv("text\nCaption\n\n")).toEqual([{ title: "", text: "Caption", tags: [] }]);
  });
  it("rejects ambiguous dates with the actual row number", () => {
    expect(() => parsePostCsv("text,scheduled_at\nCaption,2026-11-01T09:00:00")).toThrow("Row 2");
  });
  it("rejects truncated, misaligned and unknown columns instead of losing captions", () => {
    for (const csv of ['text\n"Unclosed', "title,text\nTitle,One,Two", "text,text\nOne,Two", "text,unknown\nOne,Two"])
      expect(() => parsePostCsv(csv)).toThrow();
  });
  it("limits a batch to 100 posts", () => {
    expect(parsePostCsv("text\n" + Array(100).fill("Caption").join("\n"))).toHaveLength(100);
    expect(() => parsePostCsv("text\n" + Array(101).fill("Caption").join("\n"))).toThrow("100 posts");
  });
});
