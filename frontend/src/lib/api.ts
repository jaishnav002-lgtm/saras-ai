const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("saras_token");
}

export function setToken(token: string) {
  localStorage.setItem("saras_token", token);
}

export function clearToken() {
  localStorage.removeItem("saras_token");
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  auth: boolean = true
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore
    }
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---- Auth ----
export function signup(name: string, email: string, password: string) {
  return request<{ access_token: string }>(
    "/api/auth/signup",
    { method: "POST", body: JSON.stringify({ name, email, password }) },
    false
  );
}

export function login(email: string, password: string) {
  return request<{ access_token: string }>(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    false
  );
}

export function getMe() {
  return request<{ id: string; name: string; email: string }>("/api/auth/me");
}

// ---- Subjects ----
export type Subject = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  document_count: number;
  last_activity: string | null;
};

export function listSubjects() {
  return request<Subject[]>("/api/subjects");
}

export function createSubject(name: string, description: string) {
  return request<Subject>("/api/subjects", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export function getSubject(id: string) {
  return request<Subject>(`/api/subjects/${id}`);
}

export function deleteSubject(id: string) {
  return request<void>(`/api/subjects/${id}`, { method: "DELETE" });
}

// ---- S Intelligence ----
export type AnswerSource = {
  chunk_id: string;
  document_id: string;
  subject_id: string;
  filename: string;
  page_number: number | null;
};

export type GroundedAnswer = {
  answer: string;
  sources: AnswerSource[];
  cached: boolean;
};

export function answerSubjectQuestion(subjectId: string, question: string) {
  return request<GroundedAnswer>(`/api/subjects/${subjectId}/answer`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

// ---- Documents ----
export type Document = {
  id: string;
  subject_id: string;
  filename: string;
  file_type: string;
  status: string;
  page_or_slide_count: number | null;
  extracted_preview: string | null;
  extracted_text?: string | null;
  error_message: string | null;
  uploaded_at: string;
};

export function listDocuments(subjectId: string) {
  return request<Document[]>(`/api/subjects/${subjectId}/documents`);
}

export function getDocument(id: string) {
  return request<Document>(`/api/documents/${id}`);
}

export function uploadDocument(subjectId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<Document>(`/api/subjects/${subjectId}/documents`, {
    method: "POST",
    body: formData,
  });
}

export function deleteDocument(id: string) {
  return request<void>(`/api/documents/${id}`, { method: "DELETE" });
}

export function getDocumentFileUrl(id: string, download: boolean = false): string {
  const token = getToken();
  const base = `${API_URL}/api/documents/${id}/file`;
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  if (download) params.set("download", "true");
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export type SlideTextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  font_size?: number | null;
  font_name?: string | null;
  color?: string | null;
};

export type SlideParagraph = {
  text: string;
  level: number;
  alignment: "left" | "center" | "right" | "justify";
  runs: SlideTextRun[];
};

export type SlideTableCell = {
  text: string;
  fill_color?: string | null;
  paragraphs?: SlideParagraph[];
};

export type SlideElement = {
  id: string;
  name: string;
  type: "text" | "image" | "table" | "shape";
  left: number;
  top: number;
  width: number;
  height: number;
  rotation?: number;
  fill_color?: string | null;
  border_color?: string | null;
  src?: string;
  alt?: string;
  paragraphs?: SlideParagraph[];
  rows?: SlideTableCell[][];
};

export type SlideData = {
  slide_number: number;
  background_color?: string | null;
  elements: SlideElement[];
};

export type PresentationData = {
  document_id: string;
  filename: string;
  total_slides: number;
  aspect_ratio: number;
  slide_width: number;
  slide_height: number;
  slides: SlideData[];
};

export function getDocumentSlides(documentId: string) {
  return request<PresentationData>(`/api/documents/${documentId}/slides`);
}

// ---- Timetable import ----
export type ExamEntry = {
  subject: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  subject_id: string | null;
  confidence?: { overall?: number | null } | null;
  warnings: string[];
  source_page?: number | null;
};

export function extractTimetable(file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<{ entries: ExamEntry[]; warnings: string[]; ocr_item_count: number }>(
    "/api/timetables/extract", { method: "POST", body }
  );
}

export function confirmTimetable(entries: ExamEntry[]) {
  return request<{ batch_id: string; entries: ExamEntry[] }>("/api/timetables/confirm", {
    method: "POST", body: JSON.stringify({ entries }),
  });
}

export { ApiError };
