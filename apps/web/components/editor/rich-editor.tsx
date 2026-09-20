"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Hash, Italic, List, ListOrdered, Smile } from "lucide-react";
import { richDocToPlainText, type RichNode } from "@platform/social-core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const EMOJIS = [
  "🚀",
  "✨",
  "🔥",
  "💡",
  "🎉",
  "☕",
  "📈",
  "✅",
  "👉",
  "💬",
  "🙌",
  "❤️",
  "🌱",
  "📣",
  "🧠",
  "⚡",
  "🏆",
  "🤝",
  "📅",
  "🎯",
];

export interface RichEditorProps {
  /** Initial ProseMirror document */
  initialDoc?: RichNode;
  placeholder?: string;
  className?: string;
  minRows?: number;
  onChange: (plainText: string, doc: RichNode) => void;
  /** Optional right-hand toolbar slot (e.g. AI buttons) */
  extraToolbar?: React.ReactNode;
  /** External replacement of the whole document (e.g. AI rewrite). Increment `version` to apply. */
  replaceWith?: { version: number; doc: RichNode } | null;
  /** Receives the Tiptap editor so the parent can read or replace the current selection. */
  editorRef?: React.MutableRefObject<Editor | null>;
}

/** Plain text (paragraphs separated by blank lines) → HTML the editor can insert. */
export function plainTextToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** The currently selected plain text and its range, or null when nothing is selected. */
export function currentSelection(editor: Editor | null): { from: number; to: number; text: string } | null {
  if (!editor) return null;
  const { from, to } = editor.state.selection;
  if (from === to) return null;
  const text = editor.state.doc.textBetween(from, to, "\n").trim();
  return text ? { from, to, text } : null;
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={active ? "secondary" : "ghost"}
      className="size-8"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </Button>
  );
}

/**
 * LinkedIn-style rich text editor. Bold/italic/lists are rendered natively
 * while editing and serialised to Unicode styling + bullet characters for
 * publishing, because social APIs only accept plain text.
 */
export function RichEditor({
  initialDoc,
  placeholder,
  className,
  minRows = 6,
  onChange,
  extraToolbar,
  replaceWith,
  editorRef,
}: RichEditorProps) {
  const lastVersion = useRef(0);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        link: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? "Write your post…" }),
    ],
    content: initialDoc,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none px-3 py-2 text-[15px] leading-relaxed",
          `min-h-[${minRows * 1.6}rem]`,
        ),
      },
    },
    onUpdate: ({ editor }) => {
      const doc = editor.getJSON() as RichNode;
      onChange(richDocToPlainText(doc), doc);
    },
  });

  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);

  useEffect(() => {
    if (!editor || !replaceWith || replaceWith.version === lastVersion.current) return;
    lastVersion.current = replaceWith.version;
    editor.commands.setContent(replaceWith.doc);
    const doc = editor.getJSON() as RichNode;
    onChange(richDocToPlainText(doc), doc);
  }, [editor, replaceWith, onChange]);

  const insert = (text: string) => editor?.chain().focus().insertContent(text).run();

  return (
    <div className={cn("rounded-md border bg-background", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
        <ToolbarButton
          title="Bold"
          active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          title="Bullet list"
          active={editor?.isActive("bulletList")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={editor?.isActive("orderedList")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <ToolbarButton title="Insert hashtag" onClick={() => insert("#")}>
          <Hash />
        </ToolbarButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              title="Emoji"
              aria-label="Emoji"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Smile />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="grid w-56 grid-cols-6 gap-1 p-2">
            {EMOJIS.map((e) => (
              <button key={e} type="button" className="rounded p-1 text-lg hover:bg-accent" onClick={() => insert(e)}>
                {e}
              </button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto flex items-center gap-1">{extraToolbar}</span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

export type { Editor };
