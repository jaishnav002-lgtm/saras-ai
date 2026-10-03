import type { JSONContent } from "@tiptap/core";

export type NoteContent = JSONContent;

export type Note = {
  id: string;
  title: string;
  content: NoteContent;
  subjectId: string | null;
  parentNoteId: string | null;
  createdAt: string;
  updatedAt: string;
  icon?: string;
  favorite?: boolean;
};
