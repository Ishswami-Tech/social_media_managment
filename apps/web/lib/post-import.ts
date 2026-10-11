import { z } from "zod";

export const importRowInput = z.object({
  title: z.string().max(200).default(""),
  text: z.string().trim().min(1, "Post text is required").max(65_000),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
});

export const bulkImportInput = z.object({
  importId: z.uuid(),
  accountIds: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length),
  rows: z.array(importRowInput).min(1).max(100),
});

export type ImportRow = z.infer<typeof importRowInput>;

/** RFC 4180 fields, including escaped quotes, CRLF and multiline captions. */
export function parsePostCsv(input: string): ImportRow[] {
  if (input.length > 2_000_000) throw new Error("CSV must be smaller than 2 MB");
  const records: string[][] = [];
  let record: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const endField = () => {
    record.push(field);
    field = "";
    closed = false;
  };
  const endRecord = () => {
    endField();
    if (record.some((cell) => cell.trim())) records.push(record);
    record = [];
    if (records.length > 101) throw new Error("Import up to 100 posts at a time");
  };
  const source = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else field += char;
    } else if (char === ",") endField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      endRecord();
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (closed || char === '"')
      throw new Error("Invalid CSV quoting. Wrap captions containing commas in double quotes.");
    else field += char;
  }
  if (quoted) throw new Error("A quoted CSV field was not closed");
  endRecord();
  const headers = records.shift()?.map((h) => h.trim().toLowerCase());
  if (!headers?.includes("text"))
    throw new Error("CSV needs a text column. Optional columns: title, scheduled_at, tags.");
  if (new Set(headers).size !== headers.length) throw new Error("CSV column names must be unique");
  if (headers.some((h) => !["title", "text", "scheduled_at", "tags"].includes(h)))
    throw new Error("Supported columns: title, text, scheduled_at, tags");
  if (!records.length) throw new Error("Add at least one post below the header");
  return records.map((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`Row ${i + 2}: number of fields does not match the header`);
    const row = Object.fromEntries(headers.map((h, index) => [h, cells[index]!.trim()]));
    const parsed = importRowInput.safeParse({
      title: row.title ?? "",
      text: row.text,
      scheduledAt: row.scheduled_at || undefined,
      tags: row.tags
        ? row.tags
            .split("|")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    });
    if (!parsed.success)
      throw new Error(
        `Row ${i + 2}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}. Dates must include a timezone, e.g. 2026-11-01T09:00:00+05:30.`,
      );
    return parsed.data;
  });
}
