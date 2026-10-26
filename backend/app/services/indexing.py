"""Document-chunk embedding and persistent FAISS indexing (no retrieval)."""
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from app.config import Settings, settings as global_settings
from app.models import DocumentChunk
from app.services.faiss_index import FaissIndexManager
from app.services.nemotron import NemotronEmbeddingService
from app.services.retrieval_cache import RetrievalCache
from app.services.answer_cache import AnswerCache


class DocumentEmbeddingIndexer:
    """Incrementally embed and index document chunks scoped to their subject."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        embedding_service: Optional[NemotronEmbeddingService] = None,
        index_manager: Optional[FaissIndexManager] = None,
    ):
        self.settings = settings or global_settings
        self.embedding_service = embedding_service or NemotronEmbeddingService(self.settings)
        self.index_manager = index_manager or FaissIndexManager(self.settings)

    def index_chunks(self, chunks: Iterable[DocumentChunk], db: Session) -> int:
        """Index only new or changed chunks; duplicate unchanged chunks make no API call."""
        grouped = {}
        for chunk in chunks:
            grouped.setdefault(chunk.subject_id, []).append(chunk)

        indexed = 0
        status_updated = False
        for subject_id, subject_chunks in grouped.items():
            index = self.index_manager.get_index(subject_id)
            candidates = [
                chunk for chunk in subject_chunks
                if index.chunk_content_hashes.get(chunk.id) != chunk.content_hash
            ]
            if candidates:
                vectors = self.embedding_service.embed_passages(
                    [chunk.content for chunk in candidates], db=db
                )
                indexed += index.sync_chunks(
                    [chunk.id for chunk in candidates],
                    [chunk.content_hash for chunk in candidates],
                    vectors,
                )
            # A prior process may have completed the FAISS write but not committed
            # the chunk state. Mark those verified mappings without another API call.
            for chunk in subject_chunks:
                if index.chunk_content_hashes.get(chunk.id) == chunk.content_hash and chunk.status != "indexed":
                    chunk.status = "indexed"
                    status_updated = True
        if indexed or status_updated:
            db.commit()
        if indexed:
            for subject_id in grouped:
                RetrievalCache().invalidate_subject(db, subject_id)
                AnswerCache().invalidate_subject(db, subject_id)
        return indexed

    def remove_chunks(self, subject_id: str, chunk_ids: Iterable[str]) -> int:
        """Remove a document's vectors before its chunk rows are deleted."""
        removed = self.index_manager.get_index(subject_id).delete_chunks(list(chunk_ids))
        # Callers may be deleting/re-indexing outside the document router.
        return removed
