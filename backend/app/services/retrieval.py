"""Authorized hybrid BM25 + FAISS retrieval with reciprocal-rank fusion."""
import hashlib
import math
import re
from collections import Counter
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import Settings, settings as global_settings
from app.models import DocumentChunk, Subject
from app.services.embedding_cache import normalize_embedding_content
from app.services.faiss_index import FaissIndexManager
from app.services.nemotron import NemotronEmbeddingService
from app.services.retrieval_cache import RetrievalCache


_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:[+#./:-][A-Za-z0-9_+#./:-]+)*|\d+(?:\.\d+)?")


def tokenize_for_bm25(text: str) -> List[str]:
    """Keep identifiers and common technical punctuation (C++, x86-64, foo.bar)."""
    normalized = normalize_embedding_content(text).casefold()
    tokens = _TOKEN_RE.findall(normalized)
    # Non-whitespace terms preserve compact formula-like expressions as an exact token.
    tokens.extend(term for term in normalized.split() if any(ch in term for ch in "=()[]{}"))
    return tokens


def bm25_rank(query: str, chunks: Iterable[DocumentChunk], limit: int) -> List[Dict[str, Any]]:
    docs = list(chunks)
    if not docs or limit <= 0:
        return []
    query_tokens = tokenize_for_bm25(query)
    if not query_tokens:
        return []
    tokenized = {chunk.id: tokenize_for_bm25(chunk.content) for chunk in docs}
    avg_len = sum(len(tokens) for tokens in tokenized.values()) / len(docs) or 1.0
    doc_freq = Counter(token for tokens in tokenized.values() for token in set(tokens))
    k1, b = 1.5, 0.75
    scores: List[Tuple[str, float]] = []
    for chunk in docs:
        terms = tokenized[chunk.id]
        term_counts = Counter(terms)
        score = 0.0
        for token in set(query_tokens):
            if token not in term_counts:
                continue
            idf = math.log(1.0 + (len(docs) - doc_freq[token] + 0.5) / (doc_freq[token] + 0.5))
            tf = term_counts[token]
            score += idf * (tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * len(terms) / avg_len))
        if score > 0:
            scores.append((chunk.id, score))
    scores.sort(key=lambda item: (-item[1], item[0]))
    return [{"chunk_id": chunk_id, "score": score} for chunk_id, score in scores[:limit]]


def fuse_rrf(
    semantic: List[Dict[str, Any]], keyword: List[Dict[str, Any]], rrf_k: int, top_k: int
) -> List[Dict[str, Any]]:
    if rrf_k < 0:
        raise ValueError("RRF k must be non-negative")
    combined: Dict[str, Dict[str, Any]] = {}
    for label, rows in (("semantic", semantic), ("keyword", keyword)):
        for rank, row in enumerate(rows, start=1):
            chunk_id = row["chunk_id"]
            result = combined.setdefault(chunk_id, {"chunk_id": chunk_id, "score": 0.0})
            result["score"] += 1.0 / (rrf_k + rank)
            result[f"{label}_rank"] = rank
            result[f"{label}_score"] = float(row.get("score", 0.0))
    return sorted(combined.values(), key=lambda row: (-row["score"], row["chunk_id"]))[:top_k]


class HybridRetrievalService:
    def __init__(
        self,
        settings: Optional[Settings] = None,
        embedding_service: Optional[NemotronEmbeddingService] = None,
        index_manager: Optional[FaissIndexManager] = None,
        cache: Optional[RetrievalCache] = None,
    ):
        self.settings = settings or global_settings
        self.embedding_service = embedding_service or NemotronEmbeddingService(self.settings)
        self.index_manager = index_manager or FaissIndexManager(self.settings)
        self.cache = cache or RetrievalCache()

    def _authorized_chunks(self, db: Session, subject_id: str, user_id: str) -> List[DocumentChunk]:
        subject = db.query(Subject).filter(Subject.id == subject_id, Subject.user_id == user_id).first()
        if subject is None:
            raise PermissionError("You do not have access to this subject")
        return (
            db.query(DocumentChunk)
            .filter(DocumentChunk.subject_id == subject_id, DocumentChunk.owner_id == user_id)
            .order_by(DocumentChunk.id.asc())
            .all()
        )

    def _content_version(self, chunks: Iterable[DocumentChunk]) -> str:
        value = "|".join(f"{chunk.id}:{chunk.content_hash}" for chunk in chunks)
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def _cache_identity(self, question: str, user_id: str, subject_id: str, content_version: str, top_k: int) -> Tuple[str, str]:
        settings_value = {
            "top_k": top_k, "rrf_k": self.settings.rag_rrf_k,
            "embedding_model": self.settings.nvidia_embedding_model,
            "embedding_version": self.settings.rag_embedding_version,
        }
        fingerprint = hashlib.sha256(repr(sorted(settings_value.items())).encode("utf-8")).hexdigest()
        raw = "|".join((normalize_embedding_content(question), user_id, subject_id, content_version, fingerprint))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest(), fingerprint

    @staticmethod
    def _hydrate(cached: List[Dict[str, Any]], chunks: Iterable[DocumentChunk]) -> Optional[List[Dict[str, Any]]]:
        by_id = {chunk.id: chunk for chunk in chunks}
        results = []
        for row in cached:
            chunk = by_id.get(row.get("chunk_id"))
            if chunk is None:
                return None
            results.append({
                **row, "document_id": chunk.document_id, "filename": chunk.filename,
                "page_number": chunk.page_number, "chunk_index": chunk.chunk_index,
                "content": chunk.content,
            })
        return results

    def retrieve(self, question: str, subject_id: str, user_id: str, db: Session, top_k: Optional[int] = None) -> Tuple[List[Dict[str, Any]], bool]:
        normalized = normalize_embedding_content(question)
        if not normalized:
            return [], False
        limit = top_k or self.settings.rag_top_k
        if limit <= 0:
            raise ValueError("top_k must be positive")
        chunks = self._authorized_chunks(db, subject_id, user_id)
        version = self._content_version(chunks)
        cache_key, fingerprint = self._cache_identity(normalized, user_id, subject_id, version, limit)
        lock = self.cache.lock_for(cache_key)
        with lock:
            # Authorization and current chunks are checked before every cache return.
            cached = self.cache.get(
                db, cache_key, user_id, subject_id, version, fingerprint
            )
            if cached is not None:
                hydrated = self._hydrate(cached, chunks)
                if hydrated is not None:
                    return hydrated, True

            keyword = bm25_rank(normalized, chunks, limit)
            semantic: List[Dict[str, Any]] = []
            index = self.index_manager.get_index(subject_id)
            if index.total_vectors:
                vector = self.embedding_service.embed_query(normalized, db=db)
                allowed_ids = {chunk.id for chunk in chunks}
                semantic = [row for row in index.search(vector, limit) if row["chunk_id"] in allowed_ids]
            fused = fuse_rrf(semantic, keyword, self.settings.rag_rrf_k, limit)
            hydrated = self._hydrate(fused, chunks) or []
            # Empty search is a complete result and is safe to cache; errors never reach here.
            self.cache.set(db, cache_key, user_id, subject_id, version, fingerprint, fused, self.settings.rag_retrieval_cache_ttl_seconds)
            return hydrated, False
