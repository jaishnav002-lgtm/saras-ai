"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  clearToken,
  getMe,
  getToken,
  listSubjects,
  createSubject,
  uploadDocument,
  Subject,
  ApiError,
} from "@/lib/api";
import TimetableImportModal, { ImportedCalendarEvent } from "@/components/TimetableImportModal";

// ---- Minimalist SVG Icons ----
function SearchIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function HomeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function FilesIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function UploadIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function CalendarIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v7.5" />
    </svg>
  );
}

function NotesIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function IntelligenceIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25M12 18.75V21M3 12h2.25M18.75 12H21M5.64 5.64l1.59 1.59m9.54 9.54 1.59 1.59m0-12.72-1.59 1.59m-9.54 9.54-1.59 1.59M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
    </svg>
  );
}

function LogoutIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
    </svg>
  );
}

function PlusIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function CloseIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  subjectId: string;
  endTime?: string | null;
  venue?: string | null;
  type?: "exam";
  createdFrom?: "timetable-upload";
  batchId?: string;
};

const CALENDAR_STORAGE_KEY = "saras_calendar_events";
const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatSelectedDate(key: string) {
  return dateFromKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function parseExamDetails(title: string, matchedSubjectName?: string) {
  const trimmedTitle = (title || "").trim();
  const titleMatch = trimmedTitle.match(/^([A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)?)\s*[-–—:·]\s*(.+)$/);

  if (titleMatch) {
    return {
      courseCode: titleMatch[1].trim(),
      subjectName: titleMatch[2].trim(),
    };
  }

  if (matchedSubjectName) {
    const trimmedMatched = matchedSubjectName.trim();
    const subMatch = trimmedMatched.match(/^([A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)?)\s*[-–—:·]\s*(.+)$/);
    if (subMatch) {
      if (trimmedTitle.toUpperCase() === subMatch[1].toUpperCase()) {
        return {
          courseCode: subMatch[1].trim(),
          subjectName: subMatch[2].trim(),
        };
      }
      if (trimmedTitle.toLowerCase() === subMatch[2].toLowerCase()) {
        return {
          courseCode: subMatch[1].trim(),
          subjectName: trimmedTitle,
        };
      }
      return {
        courseCode: subMatch[1].trim(),
        subjectName: trimmedTitle,
      };
    }
  }

  if (/^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)?$/.test(trimmedTitle) && matchedSubjectName && matchedSubjectName !== trimmedTitle) {
    return {
      courseCode: trimmedTitle,
      subjectName: matchedSubjectName,
    };
  }

  return {
    courseCode: null,
    subjectName: trimmedTitle,
  };
}

function formatSingleTime(t?: string | null): string {
  if (!t) return "";
  const trimmed = t.trim();
  if (!trimmed || trimmed === "All day") return trimmed;
  if (/am|pm/i.test(trimmed)) return trimmed;

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${minute} ${ampm}`;
  }
  return trimmed;
}

function formatExamTime(time?: string | null, endTime?: string | null): string {
  if (!time || time === "All day") {
    if (endTime && endTime !== "All day") {
      return formatSingleTime(endTime);
    }
    return time === "All day" ? "All day" : "";
  }
  const formattedStart = formatSingleTime(time);
  if (endTime && endTime !== "All day") {
    const formattedEnd = formatSingleTime(endTime);
    return `${formattedStart} – ${formattedEnd}`;
  }
  return formattedStart;
}

function getExamSortKey(event: CalendarEvent): string {
  if (!event.time || event.time === "All day") return "99:99";
  const matchAmPm = event.time.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (matchAmPm) {
    let hour = parseInt(matchAmPm[1], 10);
    const minute = matchAmPm[2] || "00";
    const ampm = matchAmPm[3].toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }
  return event.time;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const [user, setUser] = useState<UserProfile | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [checked, setChecked] = useState(false);

  // Modals / Overlays
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [newSubjectModalOpen, setNewSubjectModalOpen] = useState(false);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [timetableModalOpen, setTimetableModalOpen] = useState(false);
  const [notesModalOpen, setNotesModalOpen] = useState(false);

  // Calendar state. Events are stored locally so study plans remain available after a refresh.
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => dateKey(new Date()));
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [calendarFormOpen, setCalendarFormOpen] = useState(false);
  const [calendarEventTitle, setCalendarEventTitle] = useState("");
  const [calendarEventTime, setCalendarEventTime] = useState("18:00");
  const [calendarEventSubjectId, setCalendarEventSubjectId] = useState("");

  // Quick Subject Form inside sidebar
  const [newSubName, setNewSubName] = useState("");
  const [newSubDesc, setNewSubDesc] = useState("");
  const [creatingSub, setCreatingSub] = useState(false);

  // Quick Upload Form
  const [uploadSubjectId, setUploadSubjectId] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const modalFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([getMe(), listSubjects()])
      .then(([u, subs]) => {
        setUser(u);
        setSubjects(subs);
        if (subs.length > 0 && !uploadSubjectId) {
          setUploadSubjectId(subs[0].id);
        }
      })
      .catch(() => {
        clearToken();
        router.replace("/login");
      })
      .finally(() => setChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const savedEvents = localStorage.getItem(CALENDAR_STORAGE_KEY);
      if (savedEvents) {
        const parsed = JSON.parse(savedEvents);
        if (Array.isArray(parsed)) setCalendarEvents(parsed);
      }
    } catch {
      // A malformed local value should not prevent the calendar from opening.
    } finally {
      setCalendarLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (calendarLoaded) localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calendarEvents));
  }, [calendarEvents, calendarLoaded]);

  // Keyboard shortcut Cmd+K / Ctrl+K for search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setUploadModalOpen(false);
        setNewSubjectModalOpen(false);
        setCalendarModalOpen(false);
        setNotesModalOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  async function handleCreateSubjectModal(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubName.trim()) return;
    setCreatingSub(true);
    try {
      const created = await createSubject(newSubName.trim(), newSubDesc.trim());
      setSubjects((prev) => [...prev, created]);
      setNewSubName("");
      setNewSubDesc("");
      setNewSubjectModalOpen(false);
      startTransition(() => {
        router.push(`/subjects/${created.id}`);
      });
    } catch {
      // ignore
    } finally {
      setCreatingSub(false);
    }
  }

  async function handleQuickUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadSubjectId) return;

    setUploadingFile(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      await uploadDocument(uploadSubjectId, file);
      setUploadSuccess(`Successfully uploaded ${file.name}`);
      // Refresh subjects
      const updated = await listSubjects();
      setSubjects(updated);
      setTimeout(() => {
        setUploadModalOpen(false);
        setUploadSuccess(null);
        startTransition(() => {
          router.push(`/subjects/${uploadSubjectId}`);
        });
      }, 700);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploadingFile(false);
      if (modalFileInputRef.current) modalFileInputRef.current.value = "";
    }
  }

  function addCalendarEvent(e: React.FormEvent) {
    e.preventDefault();
    const title = calendarEventTitle.trim();
    if (!title) return;

    setCalendarEvents((events) => [
      ...events,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title,
        date: selectedCalendarDate,
        time: calendarEventTime,
        subjectId: calendarEventSubjectId,
      },
    ]);
    setCalendarEventTitle("");
    setCalendarEventTime("18:00");
    setCalendarFormOpen(false);
  }

  function deleteCalendarEvent(id: string) {
    setCalendarEvents((events) => events.filter((event) => event.id !== id));
  }

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <p className="text-xs uppercase tracking-widest text-neutral-400 font-mono">Loading Saras…</p>
      </div>
    );
  }

  // Determine current active section
  const isDashboard = pathname === "/dashboard";
  const isIntelligence = pathname === "/intelligence";
  const isSubjectPage = pathname?.startsWith("/subjects/");
  const activeSubjectId = isSubjectPage ? pathname.split("/")[2] : null;

  // Filtered search results
  const filteredSubjects = searchQuery
    ? subjects.filter((s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : subjects;

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : "S";
  const userDisplayName = user?.name || "Sara Patel";
  const workspaceTitle = user?.name
    ? `${user.name.split(" ")[0]}'s Workspace`
    : "Sara's Workspace";
  const calendarMonthLabel = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const calendarFirstWeekday = calendarMonth.getDay();
  const calendarDaysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarGrid = Array.from({ length: calendarFirstWeekday + calendarDaysInMonth }, (_, index) =>
    index < calendarFirstWeekday
      ? null
      : new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index - calendarFirstWeekday + 1)
  );
  const selectedDayEvents = calendarEvents
    .filter((event) => event.date === selectedCalendarDate)
    .sort((a, b) => getExamSortKey(a).localeCompare(getExamSortKey(b)));
  const selectedDateExams = selectedDayEvents.filter((event) => event.type === "exam");
  const todayKey = dateKey(new Date());

  return (
    <div className="min-h-screen flex bg-white text-neutral-900 selection:bg-neutral-900 selection:text-white">
      {/* ========================================================= */}
      {/* SIDEBAR (Dark Minimalist Column matching requested design)  */}
      {/* ========================================================= */}
      <aside className="w-64 shrink-0 bg-[#0d0d0d] text-neutral-300 border-r border-[#1f1f1f] flex flex-col justify-between select-none font-sans z-20">
        <div className="flex flex-col flex-1 overflow-y-auto min-h-0 custom-scrollbar">
          {/* 1. Header: Workspace info + Search */}
          <div className="px-4 pt-4 pb-3.5 flex items-center justify-between border-b border-[#1c1c1c]">
            <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 group">
              <div className="w-7 h-7 rounded-lg bg-[#5850ec] flex items-center justify-center text-white font-bold text-sm shadow-sm group-hover:opacity-90 transition-opacity shrink-0">
                S
              </div>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-white tracking-tight leading-tight truncate group-hover:text-neutral-200">
                  {workspaceTitle}
                </div>
                <div className="text-[10.5px] text-neutral-400 font-mono tracking-wide leading-tight mt-0.5">
                  Student · Sem 5
                </div>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-[#1a1a1a] transition-colors"
              title="Search (Cmd+K)"
              aria-label="Search"
            >
              <SearchIcon className="w-4 h-4" />
            </button>
          </div>

          {/* 2. User Row */}
          <div className="px-4 py-2.5 flex items-center gap-2.5 border-b border-[#1c1c1c]/60">
            <div className="w-6 h-6 rounded-full bg-[#20202e] text-[#a594fd] border border-[#312e58] flex items-center justify-center text-xs font-semibold shrink-0">
              {userInitial}
            </div>
            <span className="text-[13px] text-neutral-200 font-medium truncate">
              {userDisplayName}
            </span>
          </div>

          {/* 3. Main Navigation */}
          <div className="px-2.5 py-3 space-y-0.5">
            <Link
              href="/dashboard"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                isDashboard && !uploadModalOpen
                  ? "bg-[#1e1e1e] text-white font-medium shadow-inner"
                  : "text-neutral-400 hover:text-white hover:bg-[#161616]"
              }`}
            >
              <HomeIcon className="w-4 h-4 shrink-0" />
              <span>Home</span>
            </Link>

            <Link
              href="/intelligence"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors ${
                isIntelligence
                  ? "bg-[#1e1e1e] text-white font-medium shadow-inner"
                  : "text-neutral-400 hover:text-white hover:bg-[#161616]"
              }`}
            >
              <IntelligenceIcon className="w-4 h-4 shrink-0" />
              <span>S Intelligence</span>
            </Link>

            <button
              type="button"
              onClick={() => setNotesModalOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-neutral-400 hover:text-white hover:bg-[#161616] transition-colors text-left"
            >
              <FilesIcon className="w-4 h-4 shrink-0" />
              <span>My Files</span>
            </button>

            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors text-left ${
                uploadModalOpen
                  ? "bg-[#1e1e1e] text-white font-medium"
                  : "text-neutral-400 hover:text-white hover:bg-[#161616]"
              }`}
            >
              <UploadIcon className="w-4 h-4 shrink-0" />
              <span>Uploads</span>
            </button>

            <button
              type="button"
              onClick={() => setCalendarModalOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-neutral-400 hover:text-white hover:bg-[#161616] transition-colors text-left"
            >
              <CalendarIcon className="w-4 h-4 shrink-0" />
              <span>Calendar</span>
            </button>
            <button type="button" onClick={() => setTimetableModalOpen(true)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-neutral-400 hover:text-white hover:bg-[#161616] transition-colors text-left">
              <UploadIcon className="w-4 h-4 shrink-0" />
              <span>Import timetable</span>
            </button>
          </div>

          <div className="border-t border-[#1c1c1c] mx-3 my-1" />

          {/* 4. Quick Actions */}
          <div className="px-2.5 py-2 space-y-0.5">
            <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-neutral-400 font-semibold">
              Quick Actions
            </div>

            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-neutral-400 hover:text-white hover:bg-[#161616] transition-colors text-left"
            >
              <UploadIcon className="w-4 h-4 shrink-0" />
              <span>Upload File</span>
            </button>

            <Link
              href="/notes"
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors text-left ${
                pathname === "/notes" ? "bg-[#1e1e1e] text-white font-medium" : "text-neutral-400 hover:text-white hover:bg-[#161616]"
              }`}
            >
              <NotesIcon className="w-4 h-4 shrink-0" />
              <span>My Notes</span>
            </Link>
          </div>

          <div className="border-t border-[#1c1c1c] mx-3 my-1" />

          {/* 5. Subjects Section */}
          <div className="px-2.5 py-2 space-y-0.5 flex-1">
            <div className="px-3 py-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-neutral-400 font-semibold">
              <span>Subjects</span>
              <button
                type="button"
                onClick={() => setNewSubjectModalOpen(true)}
                className="hover:text-white p-0.5 rounded transition-colors"
                title="Add Subject"
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {subjects.length === 0 ? (
              <div className="px-3 py-2 text-xs text-neutral-400">
                <span>No subjects yet.</span>{" "}
                <button
                  onClick={() => setNewSubjectModalOpen(true)}
                  className="underline hover:text-white text-neutral-400"
                >
                  Create one
                </button>
              </div>
            ) : (
              <div className="space-y-0.5">
                {subjects.map((sub) => {
                  const isActive = activeSubjectId === sub.id;
                  return (
                    <Link
                      key={sub.id}
                      href={`/subjects/${sub.id}`}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors group ${
                        isActive
                          ? "bg-[#1e1e1e] text-white font-medium"
                          : "text-neutral-400 hover:text-white hover:bg-[#161616]"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                          isActive ? "bg-white" : "bg-neutral-600 group-hover:bg-neutral-400"
                        }`}
                      />
                      <span className="truncate">{sub.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 6. Sidebar Footer: Logout */}
        <div className="px-3.5 py-3 border-t border-[#1c1c1c] flex items-center justify-between text-xs bg-[#0b0b0b]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-neutral-400 text-[11px] font-mono truncate">
              Local Prototype
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-neutral-400 hover:text-white hover:bg-[#1a1a1a] transition-colors text-[11px] font-mono"
            title="Log out"
          >
            <LogoutIcon className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ========================================================= */}
      {/* MAIN CONTENT AREA                                         */}
      {/* ========================================================= */}
      <main className="flex-1 min-h-screen overflow-y-auto px-8 py-8 bg-white text-black">
        {children}
      </main>

      {/* ========================================================= */}
      {/* 🔍 SEARCH PALETTE MODAL                                    */}
      {/* ========================================================= */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24 px-4">
          <div className="w-full max-w-lg bg-[#111111] border border-neutral-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-neutral-800">
              <SearchIcon className="w-4 h-4 text-neutral-400" />
              <input
                type="text"
                autoFocus
                placeholder="Search subjects and materials..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-white text-sm w-full placeholder:text-neutral-400 font-sans"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2 max-h-80 overflow-y-auto">
              <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 px-3 py-1.5">
                Subjects ({filteredSubjects.length})
              </div>
              {filteredSubjects.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-neutral-400 font-mono">
                  No matching subjects found.
                </div>
              ) : (
                filteredSubjects.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSearchOpen(false);
                      router.push(`/subjects/${s.id}`);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-neutral-200 hover:bg-[#202020] hover:text-white text-left transition-colors"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
                      <span className="font-medium truncate">{s.name}</span>
                    </div>
                    <span className="text-xs text-neutral-400 font-mono shrink-0 ml-2">
                      {s.document_count} docs
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="px-4 py-2 bg-[#0d0d0d] border-t border-neutral-800 text-[11px] text-neutral-400 font-mono flex items-center justify-between">
              <span>Press ESC to close</span>
              <span>Quick Navigation</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 📤 QUICK UPLOAD MODAL                                      */}
      {/* ========================================================= */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#111111] text-neutral-200 border border-neutral-700 rounded-xl shadow-2xl p-6 relative">
            <button
              onClick={() => setUploadModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#1e1e1e] border border-neutral-700 flex items-center justify-center text-white">
                <UploadIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Upload Study Material</h3>
                <p className="text-xs text-neutral-400">PDF, PPTX, or DOCX (max 20MB)</p>
              </div>
            </div>

            {uploadError && (
              <div className="mb-4 text-xs bg-red-950/50 border border-red-800 text-red-300 px-3 py-2 rounded">
                {uploadError}
              </div>
            )}

            {uploadSuccess && (
              <div className="mb-4 text-xs bg-emerald-950/50 border border-emerald-800 text-emerald-300 px-3 py-2 rounded">
                {uploadSuccess}
              </div>
            )}

            {subjects.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-neutral-400 mb-3">You need a subject before uploading files.</p>
                <button
                  onClick={() => {
                    setUploadModalOpen(false);
                    setNewSubjectModalOpen(true);
                  }}
                  className="px-4 py-2 rounded bg-white text-black text-xs uppercase font-mono tracking-wider font-semibold hover:bg-neutral-200"
                >
                  Create Subject
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-neutral-400 mb-1.5">
                    Select Subject
                  </label>
                  <select
                    value={uploadSubjectId}
                    onChange={(e) => setUploadSubjectId(e.target.value)}
                    className="w-full bg-[#1c1c1c] border border-neutral-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white"
                  >
                    {subjects.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="border border-dashed border-neutral-700 rounded-xl p-6 text-center hover:border-neutral-500 transition-colors bg-[#161616]">
                  <UploadIcon className="w-8 h-8 text-neutral-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-white mb-1">
                    {uploadingFile ? "Uploading and extracting text..." : "Choose a document to upload"}
                  </p>
                  <p className="text-xs text-neutral-400 mb-4">
                    Supports .pdf, .pptx, .docx
                  </p>
                  <label className="inline-block px-4 py-2 bg-white text-black font-semibold text-xs uppercase tracking-wider rounded-lg cursor-pointer hover:bg-neutral-200 transition-colors">
                    {uploadingFile ? "Processing..." : "Select File"}
                    <input
                      ref={modalFileInputRef}
                      type="file"
                      accept=".pdf,.pptx,.docx"
                      className="hidden"
                      disabled={uploadingFile}
                      onChange={handleQuickUpload}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ➕ CREATE SUBJECT MODAL                                    */}
      {/* ========================================================= */}
      {newSubjectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#111111] text-neutral-200 border border-neutral-700 rounded-xl shadow-2xl p-6 relative">
            <button
              onClick={() => setNewSubjectModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            <h3 className="text-base font-semibold text-white mb-1">Create New Subject</h3>
            <p className="text-xs text-neutral-400 mb-4">Add a new course or subject to your workspace</p>

            <form onSubmit={handleCreateSubjectModal} className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-neutral-400 mb-1.5">
                  Subject Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CS301 — Data Structures"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  className="w-full bg-[#1c1c1c] border border-neutral-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-neutral-400 mb-1.5">
                  Description (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Trees, Graphs, Sorting algorithms"
                  value={newSubDesc}
                  onChange={(e) => setNewSubDesc(e.target.value)}
                  className="w-full bg-[#1c1c1c] border border-neutral-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewSubjectModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs uppercase font-mono tracking-wider text-neutral-400 hover:text-white border border-neutral-700 hover:border-neutral-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingSub}
                  className="px-4 py-2 rounded-lg text-xs uppercase font-mono tracking-wider font-semibold bg-white text-black hover:bg-neutral-200 transition-colors"
                >
                  {creatingSub ? "Creating..." : "Create Subject"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 📅 CALENDAR MODAL                                          */}
      {/* ========================================================= */}
      {calendarModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#111111] text-neutral-200 border border-neutral-700 rounded-xl shadow-2xl p-5 sm:p-6 relative">
            <button
              onClick={() => setCalendarModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5 pr-8">
              <div className="w-9 h-9 rounded-lg bg-[#1e1e1e] border border-neutral-700 flex items-center justify-center text-white">
                <CalendarIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Study calendar</h3>
                <p className="text-xs text-neutral-400">Plan sessions and keep track of deadlines.</p>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_16rem]">
              <section className="min-w-0 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="w-8 h-8 rounded-md border border-neutral-700 text-neutral-300 hover:text-white hover:bg-[#1d1d1d]" aria-label="Previous month">‹</button>
                    <button type="button" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="w-8 h-8 rounded-md border border-neutral-700 text-neutral-300 hover:text-white hover:bg-[#1d1d1d]" aria-label="Next month">›</button>
                  </div>
                  <h4 className="text-sm font-semibold text-white">{calendarMonthLabel}</h4>
                  <button type="button" onClick={() => { const today = new Date(); setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedCalendarDate(dateKey(today)); }} className="text-[11px] uppercase font-mono tracking-wider text-neutral-300 hover:text-white">Today</button>
                </div>
                <div className="grid grid-cols-7 overflow-hidden rounded-lg border-t border-l border-neutral-800">
                  {weekDays.map((day) => <div key={day} className="py-2 text-center text-[10px] uppercase font-mono tracking-wider text-neutral-400 border-r border-b border-neutral-800">{day}</div>)}
                  {calendarGrid.map((day, index) => {
                    if (!day) return <div key={`blank-${index}`} className="min-h-16 sm:min-h-20 bg-[#101010] border-r border-b border-neutral-800" />;
                    const key = dateKey(day);
                    const dayEvents = calendarEvents.filter((event) => event.date === key);
                    const selected = key === selectedCalendarDate;
                    return <button type="button" key={key} onClick={() => { setSelectedCalendarDate(key); setCalendarFormOpen(false); }} className={`min-h-16 sm:min-h-20 p-1.5 text-left border-r border-b border-neutral-800 transition-colors ${selected ? "bg-indigo-500/15 ring-1 ring-inset ring-indigo-400" : "bg-[#141414] hover:bg-[#1b1b1b]"}`}>
                      <span className={`inline-flex w-5 h-5 items-center justify-center rounded-full text-[11px] font-medium ${key === todayKey ? "bg-indigo-500 text-white" : "text-neutral-300"}`}>{day.getDate()}</span>
                      <div className="mt-1 space-y-0.5 overflow-hidden">
                        {dayEvents.slice(0, 2).map((event) => {
                          const isExam = event.type === "exam";
                          const { subjectName, courseCode } = isExam ? parseExamDetails(event.title) : { subjectName: event.title, courseCode: null };
                          const timeDisplay = isExam ? formatSingleTime(event.time) : event.time;
                          return (
                            <span
                              key={event.id}
                              className={`block truncate rounded px-1 py-0.5 text-[9px] ${
                                isExam
                                  ? "bg-amber-500/20 text-amber-200 border border-amber-500/30 font-medium"
                                  : "bg-indigo-500/25 text-indigo-200"
                              }`}
                            >
                              {timeDisplay && timeDisplay !== "All day" ? `${timeDisplay} ` : ""}
                              {isExam ? "Exam · " : ""}
                              {courseCode ? `${courseCode} ` : ""}
                              {subjectName}
                            </span>
                          );
                        })}
                        {dayEvents.length > 2 && <span className="block text-[9px] text-neutral-400">+{dayEvents.length - 2} more</span>}
                      </div>
                    </button>;
                  })}
                </div>

                {/* Selected Date Exam Display below the Calendar Grid */}
                {selectedDateExams.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-neutral-800">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h5 className="text-sm font-semibold text-white">
                          {formatSelectedDate(selectedCalendarDate)}
                        </h5>
                        <p className="text-xs text-neutral-400 mt-0.5">
                          {selectedDateExams.length} {selectedDateExams.length === 1 ? "exam" : "exams"}
                        </p>
                      </div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        {selectedDateExams.length} {selectedDateExams.length === 1 ? "Exam" : "Exams"}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {selectedDateExams.map((event) => {
                        const matchedSubject = subjects.find((s) => s.id === event.subjectId);
                        const { subjectName, courseCode } = parseExamDetails(event.title, matchedSubject?.name);
                        const timeFormatted = formatExamTime(event.time, event.endTime);

                        return (
                          <div
                            key={event.id}
                            className="rounded-lg border border-amber-500/30 bg-[#161616] p-3.5 transition-colors hover:border-amber-500/50"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    EXAM
                                  </span>
                                  {courseCode && (
                                    <span className="text-xs font-mono font-medium text-neutral-400">
                                      {courseCode}
                                    </span>
                                  )}
                                </div>

                                <h4 className="mt-2 text-sm font-semibold text-white leading-snug break-words">
                                  {subjectName}
                                </h4>

                                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-neutral-300">
                                  {timeFormatted && (
                                    <span className="font-mono text-neutral-300">{timeFormatted}</span>
                                  )}
                                  {timeFormatted && event.venue && (
                                    <span className="text-neutral-600">·</span>
                                  )}
                                  {event.venue && (
                                    <span className="text-neutral-400 font-sans">{event.venue}</span>
                                  )}
                                  {!courseCode && matchedSubject && matchedSubject.name !== subjectName && (
                                    <>
                                      <span className="text-neutral-600">·</span>
                                      <span className="text-neutral-400">{matchedSubject.name}</span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => deleteCalendarEvent(event.id)}
                                className="text-neutral-500 hover:text-red-400 p-1 rounded transition-colors text-base leading-none shrink-0"
                                title={`Delete ${event.title}`}
                                aria-label={`Delete ${event.title}`}
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>

              <aside className="rounded-lg bg-[#181818] border border-neutral-800 p-3.5 flex flex-col min-w-0">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-xs font-semibold text-white">{formatSelectedDate(selectedCalendarDate)}</p>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      {selectedDayEvents.length} scheduled {selectedDayEvents.length === 1 ? "session" : "sessions"}
                    </p>
                  </div>
                  <button type="button" onClick={() => setCalendarFormOpen((open) => !open)} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-black hover:bg-neutral-200 shrink-0"><PlusIcon /> Add</button>
                </div>
                {calendarFormOpen && <form onSubmit={addCalendarEvent} className="mb-3 space-y-2 border-b border-neutral-800 pb-3"><input autoFocus value={calendarEventTitle} onChange={(e) => setCalendarEventTitle(e.target.value)} placeholder="Study session or deadline" className="w-full rounded-md border border-neutral-700 bg-[#111] px-2.5 py-2 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-indigo-400" /><div className="flex gap-2"><input type="time" value={calendarEventTime} onChange={(e) => setCalendarEventTime(e.target.value)} className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-[#111] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400" /><select value={calendarEventSubjectId} onChange={(e) => setCalendarEventSubjectId(e.target.value)} className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-[#111] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400"><option value="">General</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></div><button type="submit" className="w-full rounded-md bg-indigo-500 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wide text-white hover:bg-indigo-400">Save session</button></form>}
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {selectedDayEvents.length === 0 ? (
                    <p className="py-4 text-center text-xs text-neutral-500">Nothing planned for this day.</p>
                  ) : (
                    selectedDayEvents.map((event) => {
                      const subject = subjects.find((item) => item.id === event.subjectId);
                      const isExam = event.type === "exam";
                      const { subjectName, courseCode } = isExam ? parseExamDetails(event.title, subject?.name) : { subjectName: event.title, courseCode: null };
                      const timeStr = isExam ? formatExamTime(event.time, event.endTime) : `${event.time}${event.endTime ? `–${event.endTime}` : ""}`;
                      return (
                        <div
                          key={event.id}
                          className={`rounded-md border p-2.5 ${
                            isExam
                              ? "border-amber-500/40 bg-amber-500/5"
                              : "border-neutral-800 bg-[#141414]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {isExam && (
                                  <span className="inline-flex items-center px-1 py-0.2 rounded text-[9px] font-mono font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300">
                                    EXAM
                                  </span>
                                )}
                                {courseCode && (
                                  <span className="text-[10px] font-mono text-neutral-400">
                                    {courseCode}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs font-medium text-neutral-100 break-words">
                                {subjectName}
                              </p>
                              <p className="mt-0.5 text-[10px] text-neutral-400">
                                {timeStr}
                                {event.venue ? ` · ${event.venue}` : ""}
                                {!isExam && subject ? ` · ${subject.name}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => deleteCalendarEvent(event.id)}
                              className="text-neutral-500 hover:text-red-400 px-1 shrink-0"
                              aria-label={`Delete ${event.title}`}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setCalendarModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-white text-black text-xs font-mono uppercase tracking-wider font-semibold hover:bg-neutral-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {timetableModalOpen && <TimetableImportModal subjects={subjects} existingEvents={calendarEvents} onClose={() => setTimetableModalOpen(false)} onConfirmed={(events: ImportedCalendarEvent[]) => setCalendarEvents((current) => [...current, ...events])} />}

      {/* ========================================================= */}
      {/* 📑 MY NOTES & FILES MODAL                                  */}
      {/* ========================================================= */}
      {notesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#111111] text-neutral-200 border border-neutral-700 rounded-xl shadow-2xl p-6 relative">
            <button
              onClick={() => setNotesModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white"
            >
              <CloseIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#1e1e1e] border border-neutral-700 flex items-center justify-center text-white">
                <FilesIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">My Files & Study Materials</h3>
                <p className="text-xs text-neutral-400">Quick view across all subject workspaces</p>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {subjects.map((sub) => (
                <div
                  key={sub.id}
                  onClick={() => {
                    setNotesModalOpen(false);
                    router.push(`/subjects/${sub.id}`);
                  }}
                  className="flex items-center justify-between p-3 rounded-lg bg-[#161616] hover:bg-[#202020] border border-neutral-800 transition-colors cursor-pointer"
                >
                  <div>
                    <div className="text-sm font-medium text-white flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                      {sub.name}
                    </div>
                    {sub.description && (
                      <div className="text-xs text-neutral-400 mt-0.5 line-clamp-1">
                        {sub.description}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-mono text-neutral-400 block">
                      {sub.document_count} material{sub.document_count === 1 ? "" : "s"}
                    </span>
                    <span className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">
                      Open →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
