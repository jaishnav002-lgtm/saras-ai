import hashlib
import json
import math
import unicodedata
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.database import SessionLocal
from app.models import EmbeddingCacheEntry
from app.services.exceptions import InvalidResponseError


def normalize_embedding_content(content: str) -> str:
    """Return the versioned, lossless normalization used for cache identity."""
    if not isinstance(content, str):
        raise TypeError("Embedding content must be a string.")
    return unicodedata.normalize("NFC", content.replace("\r\n", "\n").replace("\r", "\n")).strip()


def compute_cache_key(
    content: str,
    model: str,
    input_type: str = "passage",
    version: str = "v1",
) -> str:
    """
    Computes a deterministic SHA-256 cache key based on normalized content,
    model identifier, input_type ('passage' or 'query'), and preprocessing version.
    """
    normalized_content = normalize_embedding_content(content)
    raw_key = f"{version}:{model}:{input_type}:{normalized_content}"
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _validate_vector_for_cache(vector: List[float]) -> None:
    """Ensures vector is numeric, finite, non-empty, and valid before caching."""
    if not isinstance(vector, list) or len(vector) == 0:
        raise InvalidResponseError("Cannot cache empty or non-list vector.")
    for v in vector:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise InvalidResponseError("Cannot cache non-numeric, boolean, or non-finite vector values.")


class BaseEmbeddingCache(ABC):
    """
    Reusable interface for embedding vector caches.
    Can be backed by SQL, local key-value stores, or memory.
    """

    @abstractmethod
    def get(self, key: str) -> Optional[List[float]]:
        pass

    @abstractmethod
    def get_batch(self, keys: List[str]) -> Dict[str, List[float]]:
        pass

    @abstractmethod
    def set(
        self,
        key: str,
        vector: List[float],
        model: str,
        input_type: str = "passage",
        version: str = "v1",
    ) -> None:
        pass

    @abstractmethod
    def set_batch(
        self,
        items: Dict[str, List[float]],
        model: str,
        input_type: str = "passage",
        version: str = "v1",
    ) -> None:
        pass

    @abstractmethod
    def delete(self, key: str) -> None:
        pass

    @abstractmethod
    def clear(self) -> None:
        pass


class SQLEmbeddingCache(BaseEmbeddingCache):
    """
    Persistent embedding cache backed by PostgreSQL/SQLite via SQLAlchemy ORM.
    Thread-safe and idempotent under concurrent writes.
    """

    def __init__(self, db: Optional[Session] = None):
        self._db = db

    def _get_session(self) -> Session:
        return self._db if self._db is not None else SessionLocal()

    @staticmethod
    def _insert_if_absent(session: Session, values: Dict[str, Any]) -> None:
        """Atomically preserve a first successful cache entry on supported DBs."""
        dialect = session.bind.dialect.name if session.bind is not None else ""
        if dialect == "postgresql":
            session.execute(
                postgresql_insert(EmbeddingCacheEntry)
                .values(**values)
                .on_conflict_do_nothing(index_elements=["cache_key"])
            )
        elif dialect == "sqlite":
            session.execute(
                sqlite_insert(EmbeddingCacheEntry)
                .values(**values)
                .on_conflict_do_nothing(index_elements=["cache_key"])
            )
        elif not session.query(EmbeddingCacheEntry.cache_key).filter(
            EmbeddingCacheEntry.cache_key == values["cache_key"]
        ).first():
            session.add(EmbeddingCacheEntry(**values))

    def get(self, key: str) -> Optional[List[float]]:
        close_session = self._db is None
        session = self._get_session()
        try:
            entry = session.query(EmbeddingCacheEntry).filter(EmbeddingCacheEntry.cache_key == key).first()
            if entry and entry.vector_data:
                vector = json.loads(entry.vector_data)
                _validate_vector_for_cache(vector)
                if entry.dim != len(vector):
                    return None
                return vector
            return None
        finally:
            if close_session:
                session.close()

    def get_batch(self, keys: List[str]) -> Dict[str, List[float]]:
        if not keys:
            return {}

        close_session = self._db is None
        session = self._get_session()
        try:
            entries = (
                session.query(EmbeddingCacheEntry)
                .filter(EmbeddingCacheEntry.cache_key.in_(keys))
                .all()
            )
            results: Dict[str, List[float]] = {}
            for entry in entries:
                try:
                    vector = json.loads(entry.vector_data)
                    _validate_vector_for_cache(vector)
                    if entry.dim == len(vector):
                        results[entry.cache_key] = vector
                except Exception:
                    continue
            return results
        finally:
            if close_session:
                session.close()

    def set(
        self,
        key: str,
        vector: List[float],
        model: str,
        input_type: str = "passage",
        version: str = "v1",
    ) -> None:
        _validate_vector_for_cache(vector)
        close_session = self._db is None
        session = self._get_session()
        try:
            self._insert_if_absent(session, {
                "cache_key": key,
                "model": model,
                "input_type": input_type,
                "version": version,
                "dim": len(vector),
                "vector_data": json.dumps(vector),
            })
            session.commit()
        finally:
            if close_session:
                session.close()

    def set_batch(
        self,
        items: Dict[str, List[float]],
        model: str,
        input_type: str = "passage",
        version: str = "v1",
    ) -> None:
        if not items:
            return

        for vec in items.values():
            _validate_vector_for_cache(vec)

        close_session = self._db is None
        session = self._get_session()
        try:
            for key, vec in items.items():
                self._insert_if_absent(session, {
                    "cache_key": key,
                    "model": model,
                    "input_type": input_type,
                    "version": version,
                    "dim": len(vec),
                    "vector_data": json.dumps(vec),
                })

            session.commit()
        finally:
            if close_session:
                session.close()

    def delete(self, key: str) -> None:
        close_session = self._db is None
        session = self._get_session()
        try:
            session.query(EmbeddingCacheEntry).filter(EmbeddingCacheEntry.cache_key == key).delete()
            session.commit()
        finally:
            if close_session:
                session.close()

    def clear(self) -> None:
        close_session = self._db is None
        session = self._get_session()
        try:
            session.query(EmbeddingCacheEntry).delete()
            session.commit()
        finally:
            if close_session:
                session.close()


class InMemoryEmbeddingCache(BaseEmbeddingCache):
    """
    In-memory embedding cache for fast unit testing and transient sessions.
    """

    def __init__(self):
        self._store: Dict[str, Dict[str, Any]] = {}

    def get(self, key: str) -> Optional[List[float]]:
        entry = self._store.get(key)
        return list(entry["vector"]) if entry else None

    def get_batch(self, keys: List[str]) -> Dict[str, List[float]]:
        results: Dict[str, List[float]] = {}
        for k in keys:
            if k in self._store:
                results[k] = list(self._store[k]["vector"])
        return results

    def set(
        self,
        key: str,
        vector: List[float],
        model: str,
        input_type: str = "passage",
        version: str = "v1",
    ) -> None:
        _validate_vector_for_cache(vector)
        # Match persistent cache semantics: a successful existing vector is
        # immutable for its content/model/version identity.
        self._store.setdefault(key, {
            "vector": list(vector),
            "model": model,
            "input_type": input_type,
            "version": version,
        })

    def set_batch(
        self,
        items: Dict[str, List[float]],
        model: str,
        input_type: str = "passage",
        version: str = "v1",
    ) -> None:
        for k, v in items.items():
            self.set(k, v, model=model, input_type=input_type, version=version)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()
