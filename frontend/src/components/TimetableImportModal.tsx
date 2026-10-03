"use client";

import { useMemo, useRef, useState } from "react";
import { ApiError, ExamEntry, Subject, confirmTimetable, extractTimetable } from "@/lib/api";

export type ImportedCalendarEvent = {
  id: string; title: string; date: string; time: string; subjectId: string;
  endTime?: string | null; venue?: string | null; type: "exam"; createdFrom: "timetable-upload"; batchId: string;
};

const ACCEPT = ".jpg,.jpeg,.png,.pdf,.csv,.xlsx";
const blank = (): ExamEntry => ({ subject: "", date: null, start_time: null, end_time: null, venue: null, subject_id: null, warnings: [] });
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

export default function TimetableImportModal({ subjects, existingEvents, onClose, onConfirmed }: {
  subjects: Subject[]; existingEvents: { title: string; date: string; time: string; subjectId: string }[];
  onClose: () => void; onConfirmed: (events: ImportedCalendarEvent[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<ExamEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  const matched = useMemo(() => entries.map((entry) => {
    if (entry.subject_id) return entry.subject_id;
    const target = normalize(entry.subject);
    const exact = subjects.find((subject) => normalize(subject.name) === target);
    const contained = subjects.find((subject) => target.length >= 3 && (normalize(subject.name).includes(target) || target.includes(normalize(subject.name))));
    return (exact || contained)?.id || "";
  }), [entries, subjects]);

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true); setMessage(null); setFileName(file.name);
    try {
      const result = await extractTimetable(file);
      setEntries(result.entries.length ? result.entries : [blank()]);
      setMessage(result.warnings.join(" ") || (result.ocr_item_count ? `Read ${result.ocr_item_count} OCR regions. Review before importing.` : "Review the extracted exams before importing."));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Couldn't read your timetable. Try a clearer image or enter exams manually.");
      setEntries([blank()]);
    } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  function edit(index: number, key: keyof ExamEntry, value: string) {
    setEntries((old) => old.map((entry, i) => i === index ? { ...entry, [key]: value || null, warnings: entry.warnings.filter((warning) => !warning.toLowerCase().includes(key === "date" ? "date" : key === "subject" ? "subject" : "time")) } : entry));
  }

  async function confirm() {
    const reviewed = entries.map((entry, index) => ({ ...entry, subject_id: matched[index] || null }));
    const invalid = reviewed.find((entry) => !entry.subject.trim() || !entry.date || (entry.end_time && entry.start_time && entry.end_time <= entry.start_time));
    if (invalid) { setMessage("Every exam needs a subject and complete date; an end time must be after its start time."); return; }
    const duplicates = reviewed.filter((entry) => existingEvents.some((event) => event.date === entry.date && event.time === (entry.start_time || "") && (event.subjectId === entry.subject_id || normalize(event.title) === normalize(entry.subject))));
    if (duplicates.length && !window.confirm(`${duplicates.length} possible duplicate exam(s) are already on the calendar. Import anyway?`)) return;
    setBusy(true); setMessage(null);
    try {
      const result = await confirmTimetable(reviewed);
      onConfirmed(result.entries.map((entry, index) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`, title: entry.subject, date: entry.date!, time: entry.start_time || "All day",
        subjectId: entry.subject_id || "", endTime: entry.end_time, venue: entry.venue, type: "exam", createdFrom: "timetable-upload", batchId: result.batch_id,
      })));
      onClose();
    } catch (error) { setMessage(error instanceof ApiError ? error.message : "Could not confirm timetable."); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
    <div className="max-h-[calc(100vh-2rem)] w-full max-w-6xl overflow-y-auto rounded-xl border border-neutral-700 bg-[#111] p-5 text-neutral-200 shadow-2xl">
      <div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold text-white">Import exam timetable</h2><p className="mt-1 text-xs text-neutral-400">JPG, PNG, PDF, CSV, or XLSX. Nothing is added to your calendar until you confirm.</p></div><button onClick={onClose} className="text-neutral-400 hover:text-white">×</button></div>
      {!entries.length && <div className="rounded-lg border border-dashed border-neutral-700 p-7 text-center"><p className="text-sm text-neutral-300">Upload an exam timetable for review.</p><label className="mt-3 inline-block cursor-pointer rounded-md bg-white px-3 py-2 text-xs font-mono font-semibold uppercase tracking-wide text-black">{busy ? "Extracting…" : "Choose timetable"}<input ref={input} className="hidden" type="file" accept={ACCEPT} disabled={busy} onChange={(e) => upload(e.target.files?.[0])} /></label></div>}
      {message && <p className="my-3 rounded border border-neutral-700 bg-[#181818] px-3 py-2 text-xs text-neutral-300">{message}</p>}
      {!!entries.length && <><div className="mb-3 flex items-center justify-between"><span className="text-xs text-neutral-400">{fileName} · {entries.length} exam{entries.length === 1 ? "" : "s"}</span><label className="cursor-pointer text-xs text-indigo-300 hover:text-indigo-200">Choose another<input ref={input} className="hidden" type="file" accept={ACCEPT} disabled={busy} onChange={(e) => upload(e.target.files?.[0])} /></label></div>
      <div className="overflow-x-auto rounded-lg border border-neutral-800"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-[#181818] text-neutral-400"><tr><th className="p-2">Subject</th><th className="p-2">Date</th><th className="p-2">Start</th><th className="p-2">End</th><th className="p-2">Venue</th><th className="p-2">Matched subject</th><th className="p-2">Review</th><th /></tr></thead><tbody>{entries.map((entry, index) => <tr key={index} className="border-t border-neutral-800 align-top"><td className="p-2"><input value={entry.subject} onChange={(e) => edit(index, "subject", e.target.value)} className="w-36 rounded border border-neutral-700 bg-[#111] p-1.5 text-white" /></td><td className="p-2"><input type="date" value={entry.date || ""} onChange={(e) => edit(index, "date", e.target.value)} className="rounded border border-neutral-700 bg-[#111] p-1.5 text-white" /></td><td className="p-2"><input type="time" value={entry.start_time || ""} onChange={(e) => edit(index, "start_time", e.target.value)} className="rounded border border-neutral-700 bg-[#111] p-1.5 text-white" /></td><td className="p-2"><input type="time" value={entry.end_time || ""} onChange={(e) => edit(index, "end_time", e.target.value)} className="rounded border border-neutral-700 bg-[#111] p-1.5 text-white" /></td><td className="p-2"><input value={entry.venue || ""} onChange={(e) => edit(index, "venue", e.target.value)} className="w-28 rounded border border-neutral-700 bg-[#111] p-1.5 text-white" /></td><td className="p-2"><select value={matched[index]} onChange={(e) => edit(index, "subject_id", e.target.value)} className="max-w-36 rounded border border-neutral-700 bg-[#111] p-1.5 text-white"><option value="">Select subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></td><td className="max-w-40 p-2 text-[10px] text-amber-200">{entry.warnings.join(" ") || (entry.confidence?.overall != null && entry.confidence.overall < .65 ? "Low OCR confidence." : "Ready")}</td><td className="p-2"><button onClick={() => setEntries((old) => old.filter((_, i) => i !== index))} className="text-neutral-500 hover:text-red-400">Delete</button></td></tr>)}</tbody></table></div>
      <div className="mt-4 flex justify-between"><button onClick={() => setEntries((old) => [...old, blank()])} className="rounded border border-neutral-700 px-3 py-2 text-xs hover:text-white">Add exam manually</button><button disabled={busy} onClick={confirm} className="rounded bg-indigo-500 px-3 py-2 text-xs font-mono font-semibold uppercase tracking-wide text-white hover:bg-indigo-400 disabled:opacity-50">{busy ? "Confirming…" : "Confirm & add to calendar"}</button></div></>}
    </div>
  </div>;
}
