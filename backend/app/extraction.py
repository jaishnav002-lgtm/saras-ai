"""
Text extraction for uploaded documents (PDF, PPTX, DOCX).
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class ExtractionResult:
    full_text: str
    unit_count: int  # page count (pdf) or slide count (pptx); paragraphs for docx


def extract_pdf(path: str) -> ExtractionResult:
    import fitz  # PyMuPDF

    doc = fitz.open(path)
    text_parts = []
    for idx, page in enumerate(doc, start=1):
        txt = page.get_text().strip()
        if txt:
            text_parts.append(f"--- Page {idx} ---\n{txt}")
        else:
            text_parts.append(f"--- Page {idx} ---\n[Empty page or image-only]")
    doc.close()
    return ExtractionResult(full_text="\n\n".join(text_parts), unit_count=len(doc))


def extract_pptx(path: str) -> ExtractionResult:
    from pptx import Presentation

    prs = Presentation(path)
    text_parts = []
    for idx, slide in enumerate(prs.slides, start=1):
        slide_text = []
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text:
                slide_text.append(shape.text.strip())
        content = "\n".join(slide_text).strip()
        if content:
            text_parts.append(f"--- Slide {idx} ---\n{content}")
        else:
            text_parts.append(f"--- Slide {idx} ---\n[Empty slide or image-only]")
    return ExtractionResult(full_text="\n\n".join(text_parts), unit_count=len(prs.slides))


def extract_docx(path: str) -> ExtractionResult:
    import docx

    d = docx.Document(path)
    paragraphs = [p.text.strip() for p in d.paragraphs if p.text.strip()]
    return ExtractionResult(full_text="\n\n".join(paragraphs), unit_count=len(paragraphs))


def extract_text(path: str, file_type: str) -> ExtractionResult:
    file_type = file_type.lower()
    if file_type == "pdf":
        return extract_pdf(path)
    if file_type == "pptx":
        return extract_pptx(path)
    if file_type == "docx":
        return extract_docx(path)
    raise ValueError(f"Unsupported file type: {file_type}")
