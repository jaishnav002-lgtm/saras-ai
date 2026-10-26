"""Safe, idempotent repair of persisted document chunks and FAISS mappings."""
from dataclasses import asdict, dataclass
import os
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.config import Settings, settings as global_settings
from app.extraction import extract_text
from app.models import Document, DocumentChunk, Subject
from app.services.answer_cache import AnswerCache
from app.services.indexing import DocumentEmbeddingIndexer
from app.services.ingestion import DocumentIngestionService
from app.services.retrieval_cache import RetrievalCache


@dataclass
class BackfillReport:
    scanned_documents: int = 0
    current_documents: int = 0
    reingested_documents: int = 0
    indexed_chunks: int = 0
    orphan_vectors_removed: int = 0
    skipped_documents: int = 0
    failures: List[Dict[str, str]] = None  # type: ignore[assignment]
    missing_chunks: int = 0
    stale_chunks: int = 0
    already_indexed_chunks: int = 0
    orphan_vectors_detected: int = 0

    def __post_init__(self) -> None:
        if self.failures is None:
            self.failures = []

    def to_dict(self) -> Dict[str, object]:
        return asdict(self)


class DocumentIndexBackfill:
    """Audit then repair only missing, stale, or incomplete document indexes."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        ingestion: Optional[DocumentIngestionService] = None,
        indexer: Optional[DocumentEmbeddingIndexer] = None,
    ):
        self.settings = settings or global_settings
        self.ingestion = ingestion or DocumentIngestionService(self.settings)
        self.indexer = indexer or DocumentEmbeddingIndexer(self.settings)

    @staticmethod
    def _needs_index(chunks: List[DocumentChunk], hashes: Dict[str, str]) -> bool:
        return not chunks or any(
            chunk.status != "indexed" or hashes.get(chunk.id) != chunk.content_hash
            for chunk in chunks
        )

    def run(self, db: Session, dry_run: bool = False) -> BackfillReport:
        report = BackfillReport()
        documents = db.query(Document).order_by(Document.uploaded_at.asc(), Document.id.asc()).all()
        report.scanned_documents = len(documents)

        subject_ids = set()
        for document in documents:
            subject_ids.add(document.subject_id)
            chunks = list(document.chunks)
            index = self.indexer.index_manager.get_index(document.subject_id)
            for chunk in chunks:
                if chunk.id not in index.chunk_content_hashes:
                    report.missing_chunks += 1
                elif index.chunk_content_hashes[chunk.id] != chunk.content_hash:
                    report.stale_chunks += 1
                else:
                    report.already_indexed_chunks += 1

            if not self._needs_index(chunks, index.chunk_content_hashes):
                report.current_documents += 1
                continue

            if not chunks:
                if not os.path.isfile(document.storage_path):
                    report.skipped_documents += 1
                    report.failures.append({"document_id": document.id, "reason": "source file is unavailable"})
                    continue
                if dry_run:
                    report.reingested_documents += 1
                    continue
                try:
                    result = extract_text(document.storage_path, document.file_type)
                    chunks = self.ingestion.ingest_document(
                        document=document,
                        db=db,
                        extraction_result=result,
                    )
                    report.reingested_documents += 1
                except Exception as exc:  # Document-level errors must not stop other documents.
                    report.failures.append({"document_id": document.id, "reason": str(exc)[:300]})
                    continue

            if dry_run:
                continue
            try:
                report.indexed_chunks += self.indexer.index_chunks(chunks, db)
                if all(chunk.status == "indexed" for chunk in chunks):
                    document.status = "processed"
                    document.error_message = None
                    db.commit()
            except Exception as exc:  # Preserve chunks and retry on a later invocation.
                db.rollback()
                report.failures.append({"document_id": document.id, "reason": str(exc)[:300]})

        # Remove only mappings whose IDs no longer exist for that subject. This
        # is targeted stale-index repair, never a full index rebuild.
        for subject_id in subject_ids:
            valid_ids = {
                chunk_id for (chunk_id,) in db.query(DocumentChunk.id)
                .filter(DocumentChunk.subject_id == subject_id).all()
            }
            index = self.indexer.index_manager.get_index(subject_id)
            orphan_ids = [chunk_id for chunk_id in index.chunk_ids if chunk_id not in valid_ids]
            report.orphan_vectors_detected += len(orphan_ids)
            if not dry_run and orphan_ids:
                report.orphan_vectors_removed += self.indexer.remove_chunks(subject_id, orphan_ids)
                RetrievalCache().invalidate_subject(db, subject_id)
                AnswerCache().invalidate_subject(db, subject_id)
        return report
