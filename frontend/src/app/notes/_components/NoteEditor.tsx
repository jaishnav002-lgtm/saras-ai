"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import { NoteContent } from "../_lib/types";

type Command = {
  label: string;
  hint: string;
  icon: string;
  category?: string;
  run: () => void;
};

export default function NoteEditor({
  content,
  onChange,
  commandRequested,
}: {
  content: NoteContent;
  onChange: (content: NoteContent) => void;
  commandRequested: number;
}) {
  const [slashQuery, setSlashQuery] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [selectionActive, setSelectionActive] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: "Type / for commands, or start writing…",
      }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content,
    editorProps: {
      attributes: {
        class:
          "tiptap min-h-[460px] outline-none text-[15px] leading-7 text-neutral-800 focus:outline-none",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      onChange(activeEditor.getJSON());
      const { from } = activeEditor.state.selection;
      const fragment = activeEditor.state.doc.textBetween(
        Math.max(0, from - 35),
        from,
        " ",
        " "
      );
      const match = fragment.match(/(?:^|\s)\/([^\s]*)$/);
      setSlashQuery(match?.[1] ?? "");
      setSlashOpen(Boolean(match));
    },
    onSelectionUpdate: ({ editor: activeEditor }) =>
      setSelectionActive(
        activeEditor.state.selection.from !== activeEditor.state.selection.to
      ),
  });

  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => {
    if (commandRequested && editor) {
      editor.commands.focus();
      setSlashOpen(true);
      setSlashQuery("");
    }
  }, [commandRequested, editor]);

  if (!editor) return null;

  const commands: Command[] = [
    {
      label: "Text",
      hint: "Just start typing with plain text",
      icon: "📄",
      category: "BASIC BLOCKS",
      run: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: "Heading 1",
      hint: "Big section heading",
      icon: "H1",
      category: "BASIC BLOCKS",
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "Heading 2",
      hint: "Medium section heading",
      icon: "H2",
      category: "BASIC BLOCKS",
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Heading 3",
      hint: "Small section heading",
      icon: "H3",
      category: "BASIC BLOCKS",
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "Bullet list",
      hint: "Create a simple bulleted list",
      icon: "•",
      category: "LISTS",
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      hint: "Create a list with numbering",
      icon: "1.",
      category: "LISTS",
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "To-do list",
      hint: "Track tasks with a check list",
      icon: "☑",
      category: "LISTS",
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: "Code block",
      hint: "Capture code snippets with formatting",
      icon: "</>",
      category: "ADVANCED",
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "Quote",
      hint: "Capture a quote or reference",
      icon: "“",
      category: "ADVANCED",
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Divider",
      hint: "Visually divide blocks",
      icon: "—",
      category: "ADVANCED",
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ];

  const visibleCommands = commands.filter((command) =>
    command.label.toLowerCase().includes(slashQuery.toLowerCase())
  );

  function selectCommand(command: Command) {
    if (!editor) return;
    const { from } = editor.state.selection;
    const text = editor.state.doc.textBetween(
      Math.max(0, from - 35),
      from,
      " ",
      " "
    );
    const slash = text.lastIndexOf("/");
    if (slash >= 0) {
      editor
        .chain()
        .focus()
        .deleteRange({ from: from - (text.length - slash), to: from })
        .run();
    }
    command.run();
    setSlashOpen(false);
  }

  function addLink() {
    const previousUrl = editor?.getAttributes("link").href;
    const href = window.prompt("Enter or paste URL", previousUrl);
    if (href === null) return;
    if (href === "") {
      editor?.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  return (
    <div className="relative">
      {/* Selection Contextual Formatting Bubble Toolbar */}
      {selectionActive && (
        <div className="sticky top-4 z-20 mb-4 flex w-fit items-center gap-0.5 rounded-lg border border-neutral-200/80 bg-white/95 p-1 shadow-xl backdrop-blur-md transition-all duration-150 animate-in fade-in zoom-in-95">
          <ToolbarButton
            label="B"
            title="Bold (Ctrl+B)"
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            label="I"
            title="Italic (Ctrl+I)"
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            label="U"
            title="Underline (Ctrl+U)"
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <ToolbarButton
            label="S"
            title="Strikethrough"
            active={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
          <span className="mx-1 h-4 w-[1px] bg-neutral-200" />
          <ToolbarButton
            label="H1"
            title="Heading 1"
            active={editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <ToolbarButton
            label="H2"
            title="Heading 2"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            label="H3"
            title="Heading 3"
            active={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          />
          <span className="mx-1 h-4 w-[1px] bg-neutral-200" />
          <ToolbarButton
            label="Code"
            title="Inline Code"
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
          />
          <ToolbarButton
            label="Highlight"
            title="Highlight Text"
            active={editor.isActive("highlight")}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          />
          <ToolbarButton
            label="Link"
            title="Add Link"
            active={editor.isActive("link")}
            onClick={addLink}
          />
        </div>
      )}

      {/* Notion-style Slash Command Palette Dropdown */}
      {slashOpen && (
        <div className="absolute left-0 top-2 z-30 w-72 max-h-80 overflow-y-auto rounded-xl border border-neutral-200/90 bg-white p-1.5 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150 custom-scrollbar">
          <div className="px-2 py-1.5 flex items-center justify-between border-b border-neutral-100 mb-1">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-400">
              Basic Blocks
            </span>
            <span className="text-[10px] font-mono text-neutral-400">ESC to exit</span>
          </div>
          {visibleCommands.length ? (
            visibleCommands.map((command) => (
              <button
                key={command.label}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectCommand(command);
                }}
                className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-neutral-100/80 active:bg-neutral-200/60"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-xs font-mono font-semibold text-neutral-700 group-hover:border-neutral-300 group-hover:bg-white group-hover:shadow-sm">
                  {command.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-neutral-900 leading-none mb-0.5">
                    {command.label}
                  </div>
                  <div className="truncate text-[11px] text-neutral-500">
                    {command.hint}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-center text-xs text-neutral-400">
              No matching commands
            </div>
          )}
        </div>
      )}

      {/* Main Tiptap Editor Canvas */}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={`rounded-md px-2 py-1 text-xs font-mono font-medium transition-all ${
        active
          ? "bg-neutral-900 text-white shadow-sm"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      }`}
      aria-label={label}
    >
      {label}
    </button>
  );
}

