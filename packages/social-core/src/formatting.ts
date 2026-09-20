/**
 * Text formatting for social platforms.
 *
 * Social APIs accept plain text only, so "rich text" (bold, italic, bullets)
 * is emulated the way LinkedIn users do it: Unicode Mathematical Alphanumeric
 * symbols for bold/italic and bullet characters for lists. This module turns
 * a ProseMirror/Tiptap document into that plain text, and tokenises plain
 * text into segments (hashtags, mentions, links) for previews.
 */

export interface RichNode {
  type: string;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
  attrs?: Record<string, unknown>;
}

const BOLD_UPPER = 0x1d5d4; // 𝗔 sans-serif bold
const BOLD_LOWER = 0x1d5ee; // 𝗮
const BOLD_DIGIT = 0x1d7ec; // 𝟬
const ITALIC_UPPER = 0x1d608; // 𝘈 sans-serif italic
const ITALIC_LOWER = 0x1d622; // 𝘢
const BOLD_ITALIC_UPPER = 0x1d63c; // 𝘼
const BOLD_ITALIC_LOWER = 0x1d656; // 𝙖

function mapAlpha(text: string, upper: number, lower: number, digit?: number): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x41 && c <= 0x5a) out += String.fromCodePoint(upper + (c - 0x41));
    else if (c >= 0x61 && c <= 0x7a) out += String.fromCodePoint(lower + (c - 0x61));
    else if (digit !== undefined && c >= 0x30 && c <= 0x39) out += String.fromCodePoint(digit + (c - 0x30));
    else out += ch;
  }
  return out;
}

export const unicodeBold = (t: string) => mapAlpha(t, BOLD_UPPER, BOLD_LOWER, BOLD_DIGIT);
export const unicodeItalic = (t: string) => mapAlpha(t, ITALIC_UPPER, ITALIC_LOWER);
export const unicodeBoldItalic = (t: string) => mapAlpha(t, BOLD_ITALIC_UPPER, BOLD_ITALIC_LOWER);

function applyMarks(text: string, marks: RichNode["marks"] = []): string {
  const bold = marks.some((m) => m.type === "bold");
  const italic = marks.some((m) => m.type === "italic");
  if (bold && italic) return unicodeBoldItalic(text);
  if (bold) return unicodeBold(text);
  if (italic) return unicodeItalic(text);
  return text;
}

function inline(node: RichNode): string {
  if (node.type === "text") return applyMarks(node.text ?? "", node.marks);
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inline).join("");
}

/**
 * Serialise a Tiptap/ProseMirror JSON document to platform plain text.
 * Paragraphs are separated by a blank line, list items become "• " lines.
 */
export function richDocToPlainText(doc: RichNode | null | undefined): string {
  if (!doc?.content) return "";
  const blocks: string[] = [];
  const walk = (node: RichNode, depth = 0) => {
    switch (node.type) {
      case "paragraph":
      case "heading":
        blocks.push(inline(node));
        break;
      case "bulletList":
      case "orderedList": {
        const items = (node.content ?? []).map((li, i) => {
          const marker = node.type === "orderedList" ? `${i + 1}. ` : "• ";
          const lines = (li.content ?? [])
            .map((c) => (c.type === "paragraph" ? inline(c) : ""))
            .filter((l) => l.length);
          return `${"  ".repeat(depth)}${marker}${lines.join("\n")}`;
        });
        blocks.push(items.join("\n"));
        break;
      }
      case "blockquote":
        blocks.push((node.content ?? []).map((c) => `“${inline(c)}”`).join("\n"));
        break;
      default:
        (node.content ?? []).forEach((c) => walk(c, depth));
    }
  };
  doc.content.forEach((n) => walk(n));
  return blocks
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Turn existing plain text back into a document so it can be edited. */
export function plainTextToRichDoc(text: string): RichNode {
  const paragraphs = text.split(/\n{2,}/);
  return {
    type: "doc",
    content: paragraphs.map((p) => {
      const lines = p.split("\n");
      const isList = lines.length > 0 && lines.every((l) => /^\s*[•\-*]\s+/.test(l));
      if (isList) {
        return {
          type: "bulletList",
          content: lines.map((l) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: l.replace(/^\s*[•\-*]\s+/, "") }] }],
          })),
        };
      }
      const content: RichNode[] = [];
      lines.forEach((l, i) => {
        if (i > 0) content.push({ type: "hardBreak" });
        if (l.length) content.push({ type: "text", text: l });
      });
      return { type: "paragraph", content };
    }),
  };
}

export type Segment = { kind: "text" | "hashtag" | "mention" | "link" | "newline"; value: string };

const TOKEN = /(#[\p{L}\p{N}_]+)|(@[\p{L}\p{N}_.]+)|(https?:\/\/[^\s]+|www\.[^\s]+)|(\n)/gu;

/** Tokenise plain text for previews: hashtags, mentions, links and line breaks. */
export function tokenize(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    if (m[1]) out.push({ kind: "hashtag", value: m[1] });
    else if (m[2]) out.push({ kind: "mention", value: m[2] });
    else if (m[3]) out.push({ kind: "link", value: m[3] });
    else out.push({ kind: "newline", value: "\n" });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

export function extractHashtags(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((s) => s.kind === "hashtag")
        .map((s) => s.value),
    ),
  ];
}

/** LinkedIn truncates the feed view after ~210 characters or 3 lines with a "…more" link. */
export function truncateForFeed(text: string, maxChars = 210, maxLines = 3): { visible: string; truncated: boolean } {
  const lines = text.split("\n");
  let visible = lines.slice(0, maxLines).join("\n");
  let truncated = lines.length > maxLines;
  if (visible.length > maxChars) {
    visible = visible.slice(0, maxChars).replace(/\s+\S*$/, "");
    truncated = true;
  }
  return { visible, truncated };
}

/** Grapheme-aware character count that platforms use for limits. */
export function countCharacters(text: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) n++;
    return n;
  }
  return [...text].length;
}
