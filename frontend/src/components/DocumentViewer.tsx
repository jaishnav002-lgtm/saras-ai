"use client";

import { useEffect, useState } from "react";
import { Document, PresentationData, getDocument, getDocumentFileUrl, getDocumentSlides } from "@/lib/api";
import SlideViewer from "@/components/SlideViewer";

interface DocumentViewerProps {
  document: Document | null;
  onClose: () => void;
}

export default function DocumentViewer({ document, onClose }: DocumentViewerProps) {
  const [docData, setDocData] = useState<Document | null>(document);
  const [presentationData, setPresentationData] = useState<PresentationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSlides, setLoadingSlides] = useState(false);
  const [activeTab, setActiveTab] = useState<"slides" | "file" | "text">("text");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!document) return;

    // For PPTX, default to visual slide presentation view; for PDF, embedded viewer; for DOCX, reader view
    if (document.file_type === "pptx") {
      setActiveTab("slides");
    } else if (document.file_type === "pdf") {
      setActiveTab("file");
    } else {
      setActiveTab("text");
    }

    setDocData(document);
    setPresentationData(null);
    setSearchQuery("");
    setLoading(true);

    // Fetch full document metadata & text
    getDocument(document.id)
      .then((fullDoc) => {
        setDocData(fullDoc);
      })
      .catch((err) => {
        console.error("Failed to load document details:", err);
      })
      .finally(() => {
        setLoading(false);
      });

    // If PPTX, fetch rich visual presentation slide structure
    if (document.file_type === "pptx") {
      setLoadingSlides(true);
      getDocumentSlides(document.id)
        .then((pData) => {
          setPresentationData(pData);
        })
        .catch((err) => {
          console.error("Failed to load visual slide data:", err);
        })
        .finally(() => {
          setLoadingSlides(false);
        });
    }
  }, [document?.id]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!document || !docData) return null;

  const isPptx = docData.file_type === "pptx";
  const isPdf = docData.file_type === "pdf";
  const contentText = docData.extracted_text || docData.extracted_preview || "";

  function handleCopyText() {
    if (!contentText) return;
    navigator.clipboard.writeText(contentText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Split content by page/slide markers if available
  const textSections = contentText ? contentText.split(/(?=--- (?:Page|Slide) \d+ ---)/g) : [];

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-6xl h-[94vh] bg-white border border-black flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="border-b border-black p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="badge uppercase font-mono">{docData.file_type}</span>
              <h2 className="text-base font-semibold truncate" title={docData.filename}>
                {docData.filename}
              </h2>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-neutral-500">
              {docData.page_or_slide_count !== null && (
                <span>
                  {docData.page_or_slide_count}{" "}
                  {docData.file_type === "pptx"
                    ? "slides"
                    : docData.file_type === "pdf"
                    ? "pages"
                    : "paragraphs"}
                </span>
              )}
              <span>Uploaded {new Date(docData.uploaded_at).toLocaleString()}</span>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {/* View Mode Switcher */}
            <div className="flex border border-black">
              {isPptx && (
                <button
                  type="button"
                  onClick={() => setActiveTab("slides")}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wide transition-colors ${
                    activeTab === "slides"
                      ? "bg-black text-white"
                      : "bg-white text-black hover:bg-neutral-100"
                  }`}
                >
                  📽 Slide Presentation
                </button>
              )}

              {isPdf && (
                <button
                  type="button"
                  onClick={() => setActiveTab("file")}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wide transition-colors ${
                    activeTab === "file"
                      ? "bg-black text-white"
                      : "bg-white text-black hover:bg-neutral-100"
                  }`}
                >
                  Document View
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTab("text")}
                className={`px-3 py-1.5 text-xs uppercase tracking-wide transition-colors ${
                  activeTab === "text" || (!isPptx && !isPdf)
                    ? "bg-black text-white"
                    : "bg-white text-black hover:bg-neutral-100"
                }`}
              >
                Reader Text View
              </button>
            </div>

            {/* Copy extracted text */}
            {contentText && activeTab === "text" && (
              <button
                type="button"
                onClick={handleCopyText}
                className="btn-secondary text-xs py-1.5 px-3"
                title="Copy text to clipboard"
              >
                {copied ? "Copied!" : "Copy Text"}
              </button>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-xs py-1.5 px-3 font-bold"
              aria-label="Close viewer"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Search bar in text reader mode */}
        {activeTab === "text" && contentText && (
          <div className="border-b border-black px-4 py-2 bg-neutral-50 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <span className="text-xs uppercase text-neutral-500 shrink-0">Search in doc:</span>
              <input
                type="text"
                placeholder="Type keyword to highlight..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field text-xs py-1 px-2"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-neutral-500 hover:text-black underline shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
            <span className="text-xs text-neutral-500 hidden sm:inline">
              Document Text View
            </span>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 relative bg-neutral-100 overflow-hidden">
          {/* Tab 1: PPTX Visual Slide Presentation */}
          {activeTab === "slides" && isPptx && (
            <div className="w-full h-full">
              {loadingSlides && !presentationData ? (
                <div className="flex flex-col items-center justify-center h-full text-neutral-500 text-xs uppercase tracking-widest gap-2">
                  <div className="animate-spin text-xl">◌</div>
                  Rendering presentation slides…
                </div>
              ) : presentationData ? (
                <SlideViewer presentation={presentationData} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-neutral-500 p-6 text-center">
                  <p className="text-sm font-semibold mb-2">Could not render visual slides</p>
                  <p className="text-xs max-w-md mb-4">
                    Switching to Reader Text View to view extracted text content.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab("text")}
                    className="btn-primary text-xs"
                  >
                    View Reader Text
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: PDF Document View */}
          {activeTab === "file" && isPdf && (
            <div className="w-full h-full bg-neutral-200">
              <iframe
                src={getDocumentFileUrl(docData.id, false)}
                className="w-full h-full border-0"
                title={docData.filename}
              />
            </div>
          )}

          {/* Tab 3: Reader Text View */}
          {activeTab === "text" && (
            <div className="w-full h-full bg-white overflow-y-auto p-6 md:p-10 font-mono text-sm leading-relaxed select-text">
              {loading && !contentText ? (
                <div className="flex items-center justify-center h-48 text-neutral-500 text-xs uppercase tracking-widest">
                  Loading document content…
                </div>
              ) : !contentText ? (
                <div className="flex flex-col items-center justify-center h-48 text-neutral-500">
                  <p className="text-sm mb-1">No extracted text content available.</p>
                  <p className="text-xs">The document may be empty or contain non-extractable media.</p>
                </div>
              ) : (
                <div className="max-w-3xl mx-auto space-y-6">
                  {textSections.length > 1 ? (
                    textSections.map((section, idx) => {
                      const lines = section.trim().split("\n");
                      const headerLine = lines[0];
                      const bodyLines = lines.slice(1).join("\n");

                      return (
                        <div key={idx} className="border border-neutral-300 p-5 bg-neutral-50/50">
                          {headerLine && (
                            <div className="text-xs font-bold uppercase tracking-wider text-neutral-600 pb-2 mb-3 border-b border-neutral-300">
                              {headerLine}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap break-words text-neutral-800 leading-relaxed font-mono text-xs md:text-sm">
                            {renderHighlightedText(bodyLines || headerLine, searchQuery)}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="border border-neutral-300 p-6 bg-neutral-50/50 whitespace-pre-wrap break-words text-neutral-800 leading-relaxed font-mono text-xs md:text-sm">
                      {renderHighlightedText(contentText, searchQuery)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-black px-4 py-2 bg-white flex items-center justify-between text-xs text-neutral-500">
          <span>Viewing {docData.filename} directly in Saras</span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs uppercase tracking-wide hover:underline hover:text-black"
          >
            Press ESC to close
          </button>
        </div>
      </div>
    </div>
  );
}

function renderHighlightedText(text: string, query: string) {
  if (!query.trim()) return text;

  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={index} className="bg-yellow-200 text-black px-0.5 font-bold">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
