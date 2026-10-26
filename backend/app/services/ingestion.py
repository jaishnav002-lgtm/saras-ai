import hashlib
import re
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.config import Settings, settings as global_settings
from app.extraction import DocumentPage, ExtractionResult, extract_text
from app.models import Document, DocumentChunk, Subject
from app.services.exceptions import IngestionError, UnextractableDocumentError


def validate_chunk_settings(chunk_size: int, chunk_overlap: int) -> None:
    """
    Validates chunk_size and chunk_overlap constraints.
    Raises ValueError with actionable details if invalid.
    """
    if not isinstance(chunk_size, int) or chunk_size <= 0:
        raise ValueError(f"chunk_size must be a positive integer, got {chunk_size}")
    if not isinstance(chunk_overlap, int) or chunk_overlap < 0:
        raise ValueError(f"chunk_overlap cannot be negative, got {chunk_overlap}")
    if chunk_overlap >= chunk_size:
        raise ValueError(
            f"chunk_overlap ({chunk_overlap}) must be strictly less than chunk_size ({chunk_size})"
        )


def generate_stable_chunk_id(document_id: str, chunk_index: int) -> str:
    """
    Generates a deterministic UUIDv5 for a chunk based on document ID and chunk index.
    Guarantees stable identity across retries and reprocessing.
    """
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"saras://documents/{document_id}/chunks/{chunk_index}",
        )
    )


def split_text_into_chunks(
    text: str,
    chunk_size: int = 1000,
    chunk_overlap: int = 100,
) -> List[str]:
    """
    Splits text into chunks of maximum `chunk_size` with `chunk_overlap`.
    Attempts to respect paragraph, sentence, and word boundaries when possible.
    """
    validate_chunk_settings(chunk_size, chunk_overlap)

    cleaned = text.strip()
    if not cleaned:
        return []

    if len(cleaned) <= chunk_size:
        return [cleaned]

    chunks: List[str] = []
    start = 0
    text_len = len(cleaned)
    step = chunk_size - chunk_overlap

    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunk = cleaned[start:end]

        # If not at the end of text, attempt to find a natural boundary near the end of the window
        if end < text_len:
            # Look for paragraph break, then sentence boundary, then word boundary
            boundary = -1
            min_boundary_offset = int(chunk_size * 0.7)

            for delimiter in ["\n\n", "\n", ". ", "? ", "! ", " "]:
                idx = chunk.rfind(delimiter)
                if idx >= min_boundary_offset:
                    boundary = idx + len(delimiter)
                    break

            if boundary > 0:
                chunk = chunk[:boundary]
                start += boundary
            else:
                start += step
        else:
            start += step

        chunk = chunk.strip()
        if chunk:
            chunks.append(chunk)

    return chunks


class DocumentIngestionService:
    """
    Modular service responsible for extracting, chunking, and persisting
    document chunks with full metadata retention and idempotent reprocessing.
    """

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or global_settings

    @property
    def default_chunk_size(self) -> int:
        return self.settings.rag_chunk_size

    @property
    def default_chunk_overlap(self) -> int:
        return self.settings.rag_chunk_overlap

    def chunk_pages(
        self,
        pages: List[DocumentPage],
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Splits a list of DocumentPages into chunks, preserving page numbers.
        """
        c_size = chunk_size if chunk_size is not None else self.default_chunk_size
        c_overlap = chunk_overlap if chunk_overlap is not None else self.default_chunk_overlap
        validate_chunk_settings(c_size, c_overlap)

        if not pages or not any(bool(p.text and p.text.strip()) for p in pages):
            raise UnextractableDocumentError(
                "Document contains no extractable text. The file may be empty or contain only scanned images."
            )

        raw_chunks: List[Dict[str, Any]] = []
        global_chunk_idx = 0

        for page in pages:
            page_text = page.text.strip()
            if not page_text:
                continue

            sub_chunks = split_text_into_chunks(page_text, chunk_size=c_size, chunk_overlap=c_overlap)
            for sub_chunk in sub_chunks:
                content_hash = hashlib.sha256(sub_chunk.encode("utf-8")).hexdigest()
                raw_chunks.append({
                    "chunk_index": global_chunk_idx,
                    "content": sub_chunk,
                    "page_number": page.page_number,
                    "content_hash": content_hash,
                })
                global_chunk_idx += 1

        return raw_chunks

    def ingest_document(
        self,
        document: Document,
        db: Session,
        extraction_result: Optional[ExtractionResult] = None,
        owner_id: Optional[str] = None,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
    ) -> List[DocumentChunk]:
        """
        Idempotently ingests and chunks a document, persisting chunks to the database.
        Retries or repeated invocations will replace existing chunks cleanly without duplicates.
        """
        c_size = chunk_size if chunk_size is not None else self.default_chunk_size
        c_overlap = chunk_overlap if chunk_overlap is not None else self.default_chunk_overlap
        validate_chunk_settings(c_size, c_overlap)

        # 1. Resolve owner_id
        resolved_owner_id = owner_id
        if not resolved_owner_id:
            subject = db.query(Subject).filter(Subject.id == document.subject_id).first()
            if subject:
                resolved_owner_id = subject.user_id
            else:
                resolved_owner_id = "system"

        # 2. Extract text if not provided
        result = extraction_result
        if result is None:
            try:
                result = extract_text(document.storage_path, document.file_type)
            except Exception as exc:
                document.status = "failed"
                document.error_message = f"Text extraction failed: {str(exc)}"
                db.commit()
                raise IngestionError(document.error_message) from exc

        # 3. Verify presence of extractable text
        if not result.has_extractable_text():
            err_msg = (
                f"Document '{document.filename}' contains no extractable text. "
                f"The file may be empty or contain only scanned images without OCR text."
            )
            document.status = "failed"
            document.error_message = err_msg
            document.extracted_text = result.full_text
            document.extracted_preview = ""
            db.commit()
            raise UnextractableDocumentError(err_msg)

        # 4. Chunk document pages preserving page numbers
        try:
            chunk_dicts = self.chunk_pages(result.pages, chunk_size=c_size, chunk_overlap=c_overlap)
        except UnextractableDocumentError as exc:
            document.status = "failed"
            document.error_message = str(exc)
            db.commit()
            raise

        if not chunk_dicts:
            err_msg = f"Document '{document.filename}' produced 0 chunks after text extraction."
            document.status = "failed"
            document.error_message = err_msg
            db.commit()
            raise UnextractableDocumentError(err_msg)

        # 5. Idempotent persistence within transaction
        try:
            # Clean up any existing chunks for this document (idempotency guarantee)
            db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).delete()

            new_chunks: List[DocumentChunk] = []
            for item in chunk_dicts:
                idx = item["chunk_index"]
                stable_id = generate_stable_chunk_id(document.id, idx)
                chunk = DocumentChunk(
                    id=stable_id,
                    document_id=document.id,
                    subject_id=document.subject_id,
                    owner_id=resolved_owner_id,
                    filename=document.filename,
                    page_number=item["page_number"],
                    chunk_index=idx,
                    content=item["content"],
                    content_hash=item["content_hash"],
                    token_count=len(item["content"].split()),
                    status="ingested",
                )
                db.add(chunk)
                new_chunks.append(chunk)

            # Update document state
            document.status = "processed"
            document.error_message = None
            document.page_or_slide_count = result.unit_count
            document.extracted_text = result.full_text
            document.extracted_preview = result.full_text[:1000]

            db.commit()
            for chunk in new_chunks:
                db.refresh(chunk)
            db.refresh(document)

            return new_chunks

        except Exception as exc:
            db.rollback()
            document.status = "failed"
            document.error_message = f"Ingestion storage failed: {str(exc)}"
            db.commit()
            raise IngestionError(document.error_message) from exc

    def get_document_chunks(self, document_id: str, db: Session) -> List[DocumentChunk]:
        """
        Retrieves all chunks for a document, ordered by chunk_index.
        """
        return (
            db.query(DocumentChunk)
            .filter(DocumentChunk.document_id == document_id)
            .order_by(DocumentChunk.chunk_index.asc())
            .all()
        )

    def get_pending_chunks(self, document_id: str, db: Session) -> List[DocumentChunk]:
        """
        Retrieves all chunks pending embedding generation (for later RAG stages).
        """
        return (
            db.query(DocumentChunk)
            .filter(
                DocumentChunk.document_id == document_id,
                DocumentChunk.status == "ingested",
            )
            .order_by(DocumentChunk.chunk_index.asc())
            .all()
        )
