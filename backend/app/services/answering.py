"""Grounded answer orchestration over authorized hybrid retrieval."""
import hashlib
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import Settings, settings as global_settings
from app.models import DocumentChunk
from app.services.answer_cache import AnswerCache
from app.services.embedding_cache import normalize_embedding_content
from app.services.exceptions import InvalidResponseError
from app.services.nvidia_nim import NvidiaNimGenerationService
from app.services.retrieval import HybridRetrievalService


INSUFFICIENT_EVIDENCE_ANSWER = "I don't have enough retrieved evidence to answer that question."


class GroundedAnswerService:
    """Generate answers only from authorized retrieved chunks and cache completed results."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        retriever: Optional[HybridRetrievalService] = None,
        generator: Optional[NvidiaNimGenerationService] = None,
        cache: Optional[AnswerCache] = None,
    ):
        self.settings = settings or global_settings
        self.retriever = retriever or HybridRetrievalService(self.settings)
        self.generator = generator or NvidiaNimGenerationService(self.settings)
        self.cache = cache or AnswerCache()

    def _sources_and_version(
        self, db: Session, retrieved: List[Dict[str, Any]], subject_id: str, user_id: str
    ) -> Tuple[List[Dict[str, Any]], str]:
        ids = [row.get("chunk_id") for row in retrieved]
        if not ids or any(not isinstance(chunk_id, str) for chunk_id in ids):
            return [], ""
        chunks = (
            db.query(DocumentChunk)
            .filter(
                DocumentChunk.id.in_(ids), DocumentChunk.subject_id == subject_id,
                DocumentChunk.owner_id == user_id,
            ).all()
        )
        by_id = {chunk.id: chunk for chunk in chunks}
        if len(by_id) != len(ids):
            return [], ""
        sources = []
        version_parts = []
        for chunk_id in ids:
            chunk = by_id[chunk_id]
            sources.append({
                "chunk_id": chunk.id, "document_id": chunk.document_id,
                "subject_id": chunk.subject_id, "filename": chunk.filename,
                "page_number": chunk.page_number,
            })
            version_parts.append(f"{chunk.id}:{chunk.content_hash}")
        return sources, hashlib.sha256("|".join(version_parts).encode("utf-8")).hexdigest()

    def _cache_identity(
        self, question: str, user_id: str, subject_id: str, source_version: str
    ) -> Tuple[str, str]:
        settings_value = (
            "nvidia-nim", self.settings.nvidia_generation_model, self.settings.rag_answer_prompt_version,
            self.settings.rag_answer_temperature, self.settings.rag_answer_max_tokens,
        )
        settings_fingerprint = hashlib.sha256(repr(settings_value).encode("utf-8")).hexdigest()
        raw = "|".join((normalize_embedding_content(question), user_id, subject_id, source_version, settings_fingerprint))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest(), settings_fingerprint

    @staticmethod
    def _context(retrieved: List[Dict[str, Any]]) -> List[str]:
        return [
            f"[Chunk {row['chunk_id']}; document {row['document_id']}; page {row['page_number']}]\n{row['content']}"
            for row in retrieved
        ]

    def answer(
        self, question: str, subject_id: str, user_id: str, db: Session, top_k: Optional[int] = None
    ) -> Tuple[str, List[Dict[str, Any]], bool]:
        normalized = normalize_embedding_content(question)
        if not normalized:
            return INSUFFICIENT_EVIDENCE_ANSWER, [], False
        retrieved, _ = self.retriever.retrieve(normalized, subject_id, user_id, db, top_k)
        if not retrieved:
            return INSUFFICIENT_EVIDENCE_ANSWER, [], False
        sources, source_version = self._sources_and_version(db, retrieved, subject_id, user_id)
        if not sources:
            # A source changed/disappeared between retrieval and generation.
            return INSUFFICIENT_EVIDENCE_ANSWER, [], False

        cache_key, fingerprint = self._cache_identity(normalized, user_id, subject_id, source_version)
        with self.cache.lock_for(cache_key):
            # Sources were queried above using current owner/subject constraints.
            cached = self.cache.get(db, cache_key, user_id, subject_id, source_version, fingerprint)
            if cached is not None:
                answer, cached_sources = cached
                if cached_sources == sources:
                    return answer, sources, True

            answer = self.generator.generate(
                system_instruction=(
                    "Answer only from the supplied retrieved context. If the context does not "
                    "provide enough evidence, say so plainly. Do not invent facts, sources, "
                    "page numbers, or citations. Do not claim to have used information outside context."
                ),
                user_question=normalized,
                retrieved_context=self._context(retrieved),
                temperature=self.settings.rag_answer_temperature,
                max_tokens=self.settings.rag_answer_max_tokens,
            ).strip()
            if not answer:
                raise InvalidResponseError("NVIDIA NIM returned an empty answer.")
            self.cache.set(
                db, cache_key, user_id, subject_id, source_version, fingerprint,
                answer, sources, self.settings.rag_answer_cache_ttl_seconds,
            )
            return answer, sources, False
