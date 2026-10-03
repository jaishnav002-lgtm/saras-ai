"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import DocumentViewer from "@/components/DocumentViewer";
import {
  Subject,
  Document,
  getSubject,
  listDocuments,
  uploadDocument,
  deleteDocument,
  deleteSubject,
  getDocumentFileUrl,
  ApiError,
} from "@/lib/api";

const ALLOWED_EXTENSIONS = [".pdf", ".pptx", ".docx"];

export default function SubjectWorkspacePage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState<Subject | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function refresh() {
    setLoading(true);
    Promise.all([getSubject(id), listDocuments(id)])
      .then(([s, docs]) => {
        setSubject(s);
        setDocuments(docs);
      })
      .catch(() => setError("Could not load subject"))
      .finally(() => setLoading(false));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`Unsupported file type ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await uploadDocument(id, file);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteDocument(docId: string) {
    try {
      await deleteDocument(docId);
      if (selectedDoc?.id === docId) setSelectedDoc(null);
      refresh();
    } catch {
      setError("Could not delete document");
    }
  }

  async function handleDeleteSubject() {
    if (!confirm("Delete this subject and all its documents? This cannot be undone.")) return;
    try {
      await deleteSubject(id);
      router.push("/dashboard");
    } catch {
      setError("Could not delete subject");
    }
  }

  return (
    <AppShell>
      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : !subject ? (
        <p className="text-sm text-neutral-500">Subject not found.</p>
      ) : (
        <>
          <div className="flex items-start justify-between mb-8">
            <div>
              <button
                onClick={() => router.push("/dashboard")}
                className="text-xs uppercase tracking-wide text-neutral-500 hover:underline mb-2"
              >
                ← Back to dashboard
              </button>
              <h1 className="text-xl font-semibold tracking-tight">{subject.name}</h1>
              {subject.description && (
                <p className="text-sm text-neutral-500 mt-1">{subject.description}</p>
              )}
            </div>
            <button onClick={handleDeleteSubject} className="btn-secondary text-xs">
              Delete Subject
            </button>
          </div>

          {error && (
            <p className="text-sm border border-black bg-neutral-50 px-3 py-2 mb-6 max-w-lg">
              {error}
            </p>
          )}

          <section className="mb-10">
            <h2 className="text-sm uppercase tracking-widest text-neutral-500 mb-3">
              Upload material
            </h2>
            <div className="card p-6 flex items-center justify-between max-w-lg">
              <div>
                <p className="text-sm mb-1">Accepted: PDF, PPTX, DOCX</p>
                <p className="text-xs text-neutral-500">
                  Text is extracted and indexed locally.
                </p>
              </div>
              <label className="btn-primary cursor-pointer">
                {uploading ? "Uploading…" : "Choose file"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.pptx,.docx"
                  className="hidden"
                  disabled={uploading}
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </section>

          <section>
            <h2 className="text-sm uppercase tracking-widest text-neutral-500 mb-3">
              Materials ({documents.length})
            </h2>
            {documents.length === 0 ? (
              <p className="text-sm text-neutral-500">No documents uploaded yet.</p>
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div key={doc.id} className="card p-4 hover:border-black transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setSelectedDoc(doc)}
                          className="font-medium text-left truncate block hover:underline"
                          title="Click to view file in app"
                        >
                          {doc.filename}
                        </button>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-neutral-500">
                          <span className="badge uppercase">{doc.file_type}</span>
                          <StatusBadge status={doc.status} />
                          {doc.page_or_slide_count !== null && (
                            <span>{doc.page_or_slide_count} {doc.file_type === "pptx" ? "slides" : doc.file_type === "pdf" ? "pages" : "paragraphs"}</span>
                          )}
                          <span>{new Date(doc.uploaded_at).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedDoc(doc)}
                          className="text-xs uppercase tracking-wide px-3 py-1 bg-black text-white hover:bg-neutral-800 transition-colors"
                        >
                          View in App
                        </button>
                        <a
                          href={getDocumentFileUrl(doc.id, true)}
                          download={doc.filename}
                          className="text-xs uppercase tracking-wide px-2.5 py-1 border border-neutral-300 hover:border-black transition-colors"
                          title="Download a copy"
                        >
                          Download
                        </a>
                        <button
                          onClick={() => handleDeleteDocument(doc.id)}
                          className="text-xs uppercase tracking-wide text-neutral-500 hover:text-black hover:underline ml-1"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {doc.status === "failed" && doc.error_message && (
                      <p className="text-xs text-neutral-600 mt-2 border-t border-black pt-2">
                        Error: {doc.error_message}
                      </p>
                    )}
                    {doc.status === "processed" && doc.extracted_preview && (
                      <div
                        onClick={() => setSelectedDoc(doc)}
                        className="cursor-pointer group mt-2 border-t border-black pt-2"
                      >
                        <p className="text-xs text-neutral-500 line-clamp-2 group-hover:text-black transition-colors">
                          {doc.extracted_preview}
                        </p>
                        <span className="text-[10px] uppercase tracking-wider text-neutral-400 group-hover:text-black underline mt-1 block">
                          Click to read full content in app →
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* In-app Document Viewer Modal */}
          {selectedDoc && (
            <DocumentViewer
              document={selectedDoc}
              onClose={() => setSelectedDoc(null)}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className="badge">{status}</span>;
}
