"use client";

import { useEffect, useRef, useState } from "react";
import { PresentationData, SlideData, SlideElement } from "@/lib/api";

interface SlideViewerProps {
  presentation: PresentationData;
}

export default function SlideViewer({ presentation }: SlideViewerProps) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const slides = presentation.slides || [];
  const currentSlide: SlideData | undefined = slides[currentSlideIndex];
  const totalSlides = slides.length;
  const aspectRatio = presentation.aspect_ratio || 16 / 9;

  function nextSlide() {
    setCurrentSlideIndex((prev) => (prev < totalSlides - 1 ? prev + 1 : prev));
  }

  function prevSlide() {
    setCurrentSlideIndex((prev) => (prev > 0 ? prev - 1 : prev));
  }

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        nextSlide();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prevSlide();
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentSlideIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentSlideIndex(totalSlides - 1);
      } else if (e.key === "f" || e.key === "F") {
        if (!e.ctrlKey && !e.metaKey) {
          toggleFullscreen();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalSlides, currentSlideIndex]);

  if (!slides || slides.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-500 text-sm">
        No slides detected in this presentation.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-full ${
        isFullscreen ? "bg-neutral-950 text-white p-4" : "bg-neutral-100"
      }`}
    >
      {/* Top Toolbar */}
      <div
        className={`px-4 py-2 flex items-center justify-between border-b ${
          isFullscreen
            ? "border-neutral-800 bg-neutral-900 text-neutral-200"
            : "border-black bg-white"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase font-semibold tracking-wider">
            Slide {currentSlideIndex + 1} of {totalSlides}
          </span>
          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              disabled={currentSlideIndex === 0}
              onClick={prevSlide}
              className="px-2 py-0.5 text-xs border border-current disabled:opacity-30 hover:bg-black hover:text-white transition-colors"
              title="Previous Slide (Left Arrow)"
            >
              ◀ Prev
            </button>
            <button
              type="button"
              disabled={currentSlideIndex === totalSlides - 1}
              onClick={nextSlide}
              className="px-2 py-0.5 text-xs border border-current disabled:opacity-30 hover:bg-black hover:text-white transition-colors"
              title="Next Slide (Right Arrow)"
            >
              Next ▶
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleFullscreen}
            className="px-2.5 py-1 text-xs uppercase tracking-wide border border-current hover:bg-black hover:text-white transition-colors"
            title="Present Fullscreen (Press F)"
          >
            {isFullscreen ? "Exit Fullscreen" : "⛶ Present Slide Show"}
          </button>
        </div>
      </div>

      {/* Main Slide Workspace with Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Slide Thumbnail Sidebar */}
        <div
          className={`w-36 md:w-44 shrink-0 overflow-y-auto p-3 space-y-3 border-r ${
            isFullscreen
              ? "border-neutral-800 bg-neutral-900"
              : "border-black bg-neutral-50"
          }`}
        >
          <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold mb-2">
            Slides ({totalSlides})
          </div>
          {slides.map((s, idx) => {
            const isSelected = idx === currentSlideIndex;
            return (
              <button
                key={s.slide_number}
                type="button"
                onClick={() => setCurrentSlideIndex(idx)}
                className={`w-full text-left p-1.5 border transition-all block ${
                  isSelected
                    ? "border-black bg-white shadow-md ring-2 ring-black"
                    : isFullscreen
                    ? "border-neutral-800 bg-neutral-950 opacity-60 hover:opacity-100"
                    : "border-neutral-300 bg-white opacity-75 hover:opacity-100"
                }`}
              >
                <div className="flex items-center justify-between text-[10px] mb-1 font-mono text-neutral-500">
                  <span>Slide {s.slide_number}</span>
                  {isSelected && <span className="text-black font-bold">●</span>}
                </div>
                {/* Mini Slide Preview Box */}
                <div
                  className="w-full bg-white border border-neutral-200 relative overflow-hidden rounded-sm"
                  style={{ aspectRatio: `${aspectRatio}` }}
                >
                  <div className="scale-[0.25] origin-top-left w-[400%] h-[400%] pointer-events-none p-2 select-none">
                    <SlideCanvas slide={s} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Center Stage: Current Slide Canvas */}
        <div className="flex-1 flex items-center justify-center p-4 md:p-8 overflow-auto">
          <div
            className="w-full max-w-4xl shadow-2xl border border-black/80 relative rounded-sm transition-all"
            style={{
              aspectRatio: `${aspectRatio}`,
              maxHeight: isFullscreen ? "85vh" : "70vh",
            }}
          >
            {currentSlide && <SlideCanvas slide={currentSlide} />}
          </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div
        className={`px-4 py-1.5 border-t text-[11px] flex items-center justify-between ${
          isFullscreen
            ? "border-neutral-800 bg-neutral-900 text-neutral-400"
            : "border-black bg-white text-neutral-500"
        }`}
      >
        <span>
          Use <kbd className="px-1 py-0.5 border border-current font-mono text-[10px]">←</kbd> /{" "}
          <kbd className="px-1 py-0.5 border border-current font-mono text-[10px]">→</kbd> arrows or spacebar to navigate slides
        </span>
        <span>
          Slide {currentSlideIndex + 1} / {totalSlides}
        </span>
      </div>
    </div>
  );
}

/**
 * SlideCanvas renders all visual shapes, images, tables, and text elements of a slide.
 */
function SlideCanvas({ slide }: { slide: SlideData }) {
  const bgColor = slide.background_color || "#ffffff";

  return (
    <div
      className="w-full h-full relative overflow-hidden select-text"
      style={{ backgroundColor: bgColor }}
    >
      {slide.elements.map((elem) => (
        <SlideElementRenderer key={elem.id} element={elem} />
      ))}
    </div>
  );
}

/**
 * Renders individual slide elements (images, text frames, tables, shapes) at precise positions.
 */
function SlideElementRenderer({ element }: { element: SlideElement }) {
  const style: React.CSSProperties = {
    position: "absolute",
    left: `${element.left}%`,
    top: `${element.top}%`,
    width: `${element.width}%`,
    height: `${element.height}%`,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    backgroundColor: element.fill_color || undefined,
    borderColor: element.border_color || undefined,
    borderWidth: element.border_color ? "1px" : undefined,
    borderStyle: element.border_color ? "solid" : undefined,
    boxSizing: "border-box",
  };

  // 1. Picture / Image element
  if (element.type === "image" && element.src) {
    return (
      <div style={style} className="overflow-hidden flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={element.src}
          alt={element.alt || "Presentation visual"}
          className="w-full h-full object-contain pointer-events-none"
        />
      </div>
    );
  }

  // 2. Table element
  if (element.type === "table" && element.rows && element.rows.length > 0) {
    return (
      <div style={style} className="overflow-auto border border-neutral-400 bg-white">
        <table className="w-full h-full border-collapse text-[10px] sm:text-xs">
          <tbody>
            {element.rows.map((row, rIdx) => (
              <tr key={rIdx} className="border-b border-neutral-300 last:border-b-0">
                {row.map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    className="border-r border-neutral-300 last:border-r-0 p-1.5 align-top"
                    style={{ backgroundColor: cell.fill_color || undefined }}
                  >
                    {cell.paragraphs && cell.paragraphs.length > 0 ? (
                      cell.paragraphs.map((p, pIdx) => (
                        <div key={pIdx} className="mb-0.5 last:mb-0">
                          {p.runs.map((r, rIndex) => (
                            <span
                              key={rIndex}
                              style={{
                                fontWeight: r.bold ? "bold" : "normal",
                                fontStyle: r.italic ? "italic" : "normal",
                                textDecoration: r.underline ? "underline" : undefined,
                                color: r.color || undefined,
                              }}
                            >
                              {r.text}
                            </span>
                          ))}
                        </div>
                      ))
                    ) : (
                      <span>{cell.text}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 3. Text Frame / Shape with text
  if (element.paragraphs && element.paragraphs.length > 0) {
    return (
      <div
        style={style}
        className="overflow-hidden flex flex-col justify-start p-1.5 leading-snug"
      >
        {element.paragraphs.map((p, pIdx) => {
          const isBullet = p.level > 0;
          return (
            <div
              key={pIdx}
              className="flex items-start mb-1 last:mb-0"
              style={{
                textAlign: p.alignment,
                paddingLeft: isBullet ? `${p.level * 1}rem` : undefined,
              }}
            >
              {isBullet && (
                <span className="mr-1.5 select-none text-neutral-500 font-bold">
                  {p.level === 1 ? "•" : "–"}
                </span>
              )}
              <div className="flex-1">
                {p.runs && p.runs.length > 0 ? (
                  p.runs.map((run, rIdx) => {
                    const fontSizeStyle = run.font_size
                      ? { fontSize: `clamp(9px, ${run.font_size * 0.45}px, 28px)` }
                      : undefined;

                    return (
                      <span
                        key={rIdx}
                        style={{
                          fontWeight: run.bold ? "bold" : "normal",
                          fontStyle: run.italic ? "italic" : "normal",
                          textDecoration: run.underline ? "underline" : undefined,
                          color: run.color || undefined,
                          fontFamily: run.font_name || undefined,
                          ...fontSizeStyle,
                        }}
                      >
                        {run.text}
                      </span>
                    );
                  })
                ) : (
                  <span>{p.text}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // 4. Auto Shape / Rectangle
  return <div style={style} className="rounded-sm" />;
}
