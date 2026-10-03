import { Note, NoteContent } from "./types";

const STORAGE_KEY = "saras_notes";

export function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyNoteContent(): NoteContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function migrateContent(content: unknown): NoteContent {
  if (content && typeof content === "object" && !Array.isArray(content)) return content as NoteContent;
  if (!Array.isArray(content)) return emptyNoteContent();
  return {
    type: "doc",
    content: content.map((block: { type?: string; text?: string; checked?: boolean }) => {
      const text = block.text || "";
      if (block.type === "heading1" || block.type === "heading2" || block.type === "heading3") return { type: "heading", attrs: { level: Number(block.type.slice(-1)) }, content: text ? [{ type: "text", text }] : [] };
      if (block.type === "bullet") return { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] }] };
      if (block.type === "numbered") return { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] }] };
      if (block.type === "todo") return { type: "taskList", content: [{ type: "taskItem", attrs: { checked: Boolean(block.checked) }, content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] }] };
      if (block.type === "code") return { type: "codeBlock", content: text ? [{ type: "text", text }] : [] };
      if (block.type === "quote") return { type: "blockquote", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] };
      if (block.type === "divider") return { type: "horizontalRule" };
      return { type: "paragraph", content: text ? [{ type: "text", text }] : [] };
    }),
  };
}

export function loadNotes(): Note[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const notes = JSON.parse(stored);
    return Array.isArray(notes) ? notes.map((note) => ({ ...note, content: migrateContent(note.content), icon: note.icon || "📝" })) : [];
  } catch {
    return [];
  }
}

export function saveNotes(notes: Note[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}
