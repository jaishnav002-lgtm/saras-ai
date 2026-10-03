"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listSubjects, Subject } from "@/lib/api";
import { emptyNoteContent, loadNotes, makeId, saveNotes } from "../_lib/storage";
import { Note, NoteContent } from "../_lib/types";
import NoteEditor from "./NoteEditor";

const icons = ["📝", "📘", "💡", "📚", "🧠", "💻", "📌", "⭐", "🧪", "📖"];

const ago = (d: string) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(d));
};

const searchText = (n: Note) =>
  `${n.title} ${JSON.stringify(n.content)}`.toLowerCase();

export default function NotesWorkspace() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [properties, setProperties] = useState(false);
  const [command, setCommand] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newIcon, setNewIcon] = useState("📝");
  const [expanded, setExpanded] = useState(new Set<string>());

  const timer = useRef<ReturnType<typeof setTimeout>>();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNotes(loadNotes());
    listSubjects()
      .then(setSubjects)
      .catch(() => setSubjects([]));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaving(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveNotes(notes);
      setSaving(false);
    }, 650);
    return () => clearTimeout(timer.current);
  }, [notes, loaded]);

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("notes-search")?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setCreateOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        clearTimeout(timer.current);
        saveNotes(notes);
        setSaving(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCommand((n) => n + 1);
      }
      if (e.key === "Escape") {
        setCreateOpen(false);
        setProperties(false);
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [notes]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const visible = useMemo(
    () =>
      notes.filter(
        (n) =>
          (filter === "all" || filter === "general"
            ? filter === "all" || !n.subjectId
            : n.subjectId === filter) &&
          (!query || searchText(n).includes(query.toLowerCase()))
      ),
    [notes, filter, query]
  );

  const update = (change: Partial<Note>) =>
    selected &&
    setNotes((all) =>
      all.map((n) =>
        n.id === selected.id
          ? { ...n, ...change, updatedAt: new Date().toISOString() }
          : n
      )
    );

  function create(parentNoteId: string | null = null) {
    const now = new Date().toISOString();
    const note: Note = {
      id: makeId(),
      title: newTitle.trim() || "Untitled note",
      content: emptyNoteContent(),
      subjectId:
        newSubject || (filter !== "all" && filter !== "general" ? filter : null),
      parentNoteId,
      createdAt: now,
      updatedAt: now,
      icon: newIcon,
    };
    setNotes((all) => [note, ...all]);
    setSelectedId(note.id);
    setCreateOpen(false);
    setNewTitle("");
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  function remove(id: string) {
    if (!confirm("Delete this note and its sub-pages?")) return;
    const ids = new Set([id]);
    let found = true;
    while (found) {
      found = false;
      notes.forEach((n) => {
        if (n.parentNoteId && ids.has(n.parentNoteId) && !ids.has(n.id)) {
          ids.add(n.id);
          found = true;
        }
      });
    }
    setNotes((all) => all.filter((n) => !ids.has(n.id)));
    if (selectedId && ids.has(selectedId)) setSelectedId(null);
  }

  function tree(parent: string | null, depth = 0): React.ReactNode {
    return visible
      .filter((n) => n.parentNoteId === parent)
      .map((n) => {
        const hasKids = visible.some((x) => x.parentNoteId === n.id);
        const open = expanded.has(n.id);
        const isSelected = selectedId === n.id;
        return (
          <div key={n.id}>
            <div
              className={`group flex items-center rounded-lg my-0.5 px-2 py-1.5 transition-all text-xs ${
                isSelected
                  ? "bg-neutral-800 text-white font-medium shadow-sm"
                  : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
              }`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              <button
                className="w-4 h-4 flex items-center justify-center text-[10px] text-neutral-500 hover:text-neutral-300"
                aria-label="Toggle sub-pages"
                onClick={() => {
                  if (!hasKids) return;
                  setExpanded((old) => {
                    const next = new Set(old);
                    if (open) next.delete(n.id);
                    else next.add(n.id);
                    return next;
                  });
                }}
              >
                {hasKids ? (
                  <svg
                    className={`w-3 h-3 transition-transform ${
                      open ? "rotate-90" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-700/60 inline-block" />
                )}
              </button>
              <button
                onClick={() => {
                  setSelectedId(n.id);
                  setMobileSidebarOpen(false);
                }}
                className="min-w-0 flex-1 truncate text-left ml-1.5 flex items-center gap-1.5"
              >
                <span className="text-sm">{n.icon || "📝"}</span>
                <span className="truncate">{n.title}</span>
              </button>
              <button
                className="ml-1 opacity-0 group-hover:opacity-100 p-0.5 rounded text-neutral-400 hover:bg-neutral-700 hover:text-white transition-opacity"
                onClick={() => {
                  setNewSubject(n.subjectId || "");
                  setNewIcon("📝");
                  setNewTitle("");
                  create(n.id);
                }}
                aria-label="New sub-page"
                title="Add child page"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </button>
            </div>
            {hasKids && open && tree(n.id, depth + 1)}
          </div>
        );
      });
  }

  const subject = subjects.find((s) => s.id === selected?.subjectId);
  const parentPage = notes.find((n) => n.id === selected?.parentNoteId);

  return (
    <div className="relative flex h-[calc(100vh-4rem)] min-h-[600px] overflow-hidden rounded-xl border border-neutral-200/80 bg-white shadow-sm">
      {/* Mobile Drawer Overlay Backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-neutral-800 bg-[#121214] text-neutral-300 transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:translate-x-0 ${
          mobileSidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        {/* Header Branding & Action */}
        <div className="p-3.5 border-b border-neutral-800/80">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded bg-neutral-800 flex items-center justify-center text-xs">
                📓
              </div>
              <p className="text-[11px] font-mono font-semibold uppercase tracking-widest text-neutral-400">
                Notes
              </p>
            </div>
            <span className="text-[10px] font-mono text-neutral-600 bg-neutral-800/60 px-1.5 py-0.5 rounded border border-neutral-700/50">
              Workspace
            </span>
          </div>

          <button
            onClick={() => {
              setNewTitle("");
              setNewSubject("");
              setNewIcon("📝");
              setCreateOpen(true);
            }}
            className="group relative flex w-full items-center justify-between rounded-lg bg-neutral-100 px-3 py-2 text-left text-xs font-medium text-neutral-900 shadow-sm transition-all hover:bg-white active:scale-[0.98]"
          >
            <span className="flex items-center gap-2 font-medium">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New note
            </span>
            <span className="font-mono text-[10px] font-semibold text-neutral-500 bg-neutral-200/70 px-1.5 py-0.5 rounded">
              ⌘N
            </span>
          </button>

          {/* Quick Search */}
          <div className="relative mt-2.5">
            <svg
              className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              id="notes-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes..."
              className="w-full rounded-lg border border-neutral-800 bg-[#1a1a1d] pl-8 pr-8 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 outline-none transition-all focus:border-neutral-600 focus:bg-[#202024]"
            />
            <span className="absolute right-2.5 top-2 font-mono text-[9px] text-neutral-500">
              ⌘K
            </span>
          </div>
        </div>

        {/* Categories / Browse Navigation */}
        <div className="border-b border-neutral-800/80 p-2.5">
          <p className="px-2 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-500">
            Browse
          </p>
          <div className="space-y-0.5">
            {[
              ["all", "All Notes", "📁"],
              ["general", "General", "📝"],
            ].map(([id, name, iconStr]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                  filter === id
                    ? "bg-neutral-800/90 text-white font-medium"
                    : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{iconStr}</span>
                  <span>{name}</span>
                </span>
                <span className="text-[10px] font-mono text-neutral-500">
                  {
                    notes.filter((n) =>
                      id === "all"
                        ? true
                        : id === "general"
                        ? !n.subjectId
                        : n.subjectId === id
                    ).length
                  }
                </span>
              </button>
            ))}

            {subjects.map((s) => (
              <button
                key={s.id}
                onClick={() => setFilter(s.id)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                  filter === s.id
                    ? "bg-neutral-800/90 text-white font-medium"
                    : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <span>📚</span>
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="text-[10px] font-mono text-neutral-500">
                  {notes.filter((n) => n.subjectId === s.id).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Notes Tree Page Hierarchy */}
        <div className="flex-1 overflow-y-auto p-2.5 custom-scrollbar">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-500">
              Pages
            </p>
            <span className="text-[10px] font-mono text-neutral-600">
              {visible.length}
            </span>
          </div>

          <div className="mt-1">
            {tree(null)}
            {!visible.length && (
              <p className="p-3 text-center text-xs text-neutral-500 italic">
                {query ? "No notes found matching search" : "No notes yet"}
              </p>
            )}
          </div>
        </div>

        {/* Recent Notes Footer */}
        <div className="border-t border-neutral-800/80 p-3">
          <p className="mb-1 px-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-500">
            Recent
          </p>
          <div className="space-y-0.5">
            {[...notes]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .slice(0, 3)
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setSelectedId(n.id);
                    setMobileSidebarOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                    selectedId === n.id
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200"
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                    <span className="text-xs">{n.icon || "📝"}</span>
                    <span className="truncate text-xs">{n.title}</span>
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] text-neutral-500 font-mono">
                    {ago(n.updatedAt)}
                  </span>
                </button>
              ))}
          </div>
        </div>
      </aside>

      {/* Main Document & Editor Canvas */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-white custom-scrollbar">
        {/* Mobile Header Bar */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 lg:hidden">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="flex items-center gap-2 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
            Menu
          </button>
          <span className="text-xs font-semibold text-neutral-800 truncate max-w-[200px]">
            {selected?.title || "Notes"}
          </span>
          <button
            onClick={() => {
              setNewTitle("");
              setNewSubject("");
              setNewIcon("📝");
              setCreateOpen(true);
            }}
            className="rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white"
          >
            + New
          </button>
        </div>

        {!selected ? (
          <Empty onCreate={() => setCreateOpen(true)} />
        ) : (
          <article className="mx-auto max-w-4xl px-6 py-8 sm:px-12 sm:py-10">
            {/* Top Toolbar Header & Breadcrumbs */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-4">
              {/* Breadcrumbs */}
              <nav className="flex items-center gap-1.5 text-xs text-neutral-500 overflow-x-auto">
                <span className="hover:text-neutral-900">Home</span>
                <span className="text-neutral-300">/</span>
                <span className="hover:text-neutral-900">Notes</span>
                <span className="text-neutral-300">/</span>
                <span className="font-medium text-neutral-700">
                  {subject?.name || "General"}
                </span>
                {parentPage && (
                  <>
                    <span className="text-neutral-300">/</span>
                    <span className="truncate max-w-[120px] text-neutral-600">
                      {parentPage.title}
                    </span>
                  </>
                )}
                <span className="text-neutral-300">/</span>
                <span className="truncate max-w-[150px] font-medium text-neutral-900">
                  {selected.title || "Untitled"}
                </span>
              </nav>

              {/* Status & Secondary Controls */}
              <div className="ml-auto flex shrink-0 items-center gap-2.5">
                <span className="flex items-center gap-1 text-[11px] font-mono">
                  {saving ? (
                    <span className="flex items-center gap-1.5 text-amber-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                      Saving...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-600 font-medium">
                      ✓ Saved
                    </span>
                  )}
                </span>

                <button
                  onClick={() => setProperties(!properties)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    properties
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                  }`}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Properties
                </button>
              </div>
            </div>

            {/* Note Icon & Document Title */}
            <div className="mb-4 flex items-start gap-3">
              <button
                onClick={() =>
                  update({
                    icon: icons[(icons.indexOf(selected.icon || "📝") + 1) % icons.length],
                  })
                }
                className="group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-200/80 bg-neutral-50/80 text-2xl transition-all hover:bg-neutral-100 hover:shadow-xs active:scale-95"
                title="Click to cycle icon"
                aria-label="Change note icon"
              >
                <span>{selected.icon || "📝"}</span>
              </button>

              <input
                ref={titleRef}
                value={selected.title}
                onChange={(e) => update({ title: e.target.value })}
                className="min-w-0 flex-1 border-0 bg-transparent text-3xl font-bold tracking-tight text-neutral-900 placeholder-neutral-300 outline-none focus:outline-none"
                placeholder="Untitled note"
              />
            </div>

            {/* Document Metadata Bar */}
            <div className="mb-8 flex flex-wrap items-center gap-3 text-xs text-neutral-500 border-b border-neutral-100 pb-4">
              <div className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1">
                <span className="text-[10px] font-mono text-neutral-400">Subject:</span>
                <select
                  value={selected.subjectId || ""}
                  onChange={(e) =>
                    update({ subjectId: e.target.value || null })
                  }
                  className="bg-transparent font-medium text-neutral-800 outline-none cursor-pointer"
                >
                  <option value="">General</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <span className="text-neutral-300">•</span>
              <span>Last edited {ago(selected.updatedAt)}</span>

              <button
                onClick={() => update({ favorite: !selected.favorite })}
                className={`ml-1 flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
                  selected.favorite
                    ? "bg-amber-50 text-amber-600 font-medium"
                    : "text-neutral-400 hover:text-neutral-700"
                }`}
                title={selected.favorite ? "Unstar note" : "Star note"}
              >
                <span>{selected.favorite ? "★" : "☆"}</span>
                <span>{selected.favorite ? "Favorited" : "Favorite"}</span>
              </button>

              <button
                onClick={() => remove(selected.id)}
                className="ml-auto flex items-center gap-1 text-neutral-400 hover:text-red-600 transition-colors"
                title="Delete note"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                <span>Delete</span>
              </button>
            </div>

            {/* TipTap Rich Editor */}
            <NoteEditor
              content={selected.content}
              onChange={(content: NoteContent) => update({ content })}
              commandRequested={command}
            />
          </article>
        )}
      </main>

      {/* Properties Slide-Over Panel */}
      {selected && properties && (
        <aside className="hidden w-64 shrink-0 border-l border-neutral-200/80 bg-neutral-50/70 p-5 xl:block">
          <div className="flex items-center justify-between mb-5 pb-3 border-b border-neutral-200/60">
            <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-500">
              Properties
            </p>
            <button
              onClick={() => setProperties(false)}
              className="text-neutral-400 hover:text-neutral-700"
              aria-label="Close properties"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4">
            <Info label="Subject" value={subject?.name || "General"} />
            <Info
              label="Created"
              value={new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
              }).format(new Date(selected.createdAt))}
            />
            <Info
              label="Last Edited"
              value={new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(selected.updatedAt))}
            />
            {parentPage && (
              <Info label="Parent Page" value={parentPage.title} />
            )}
          </div>
        </aside>
      )}

      {/* Modal Dialog for New Note */}
      {createOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
            className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-neutral-900">
                Create new note
              </h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-neutral-500 mb-4">
              Add a note to organize concepts, revision topics, or research.
            </p>

            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Title
            </label>
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Dynamic Programming Notes"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 mb-3"
            />

            <label className="block text-xs font-medium text-neutral-700 mb-1">
              Subject
            </label>
            <select
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 mb-4"
            >
              <option value="">General</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <label className="block text-xs font-medium text-neutral-700 mb-1.5">
              Choose Icon
            </label>
            <div className="flex flex-wrap gap-1.5 mb-6">
              {icons.map((icon) => (
                <button
                  type="button"
                  key={icon}
                  onClick={() => setNewIcon(icon)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                    newIcon === icon
                      ? "border-neutral-900 bg-neutral-100 text-lg shadow-xs"
                      : "border-neutral-200 bg-white text-base hover:bg-neutral-50"
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg border border-neutral-200 px-3.5 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white hover:bg-black transition-colors"
              >
                Create note
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-100 text-3xl shadow-xs border border-neutral-200/60 mb-4">
        📝
      </div>
      <h1 className="text-lg font-bold text-neutral-900">
        No note selected
      </h1>
      <p className="mt-1.5 max-w-sm text-xs leading-5 text-neutral-500">
        Select a note from the sidebar or create a new note to start writing and organizing your study material.
      </p>
      <button
        onClick={onCreate}
        className="mt-5 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white hover:bg-black transition-all shadow-sm active:scale-95"
      >
        + Create note
      </button>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p className="mt-0.5 text-xs font-medium text-neutral-800">{value}</p>
    </div>
  );
}

