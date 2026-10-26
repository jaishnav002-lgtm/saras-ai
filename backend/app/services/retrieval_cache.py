"""Persistent cache for retrieval rankings, never document content."""
import datetime
import json
import threading
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import RetrievalCacheEntry


class RetrievalCache:
    _locks: Dict[str, threading.Lock] = {}
    _locks_guard = threading.Lock()

    @classmethod
    def lock_for(cls, key: str) -> threading.Lock:
        with cls._locks_guard:
            return cls._locks.setdefault(key, threading.Lock())

    def get(
        self,
        db: Session,
        key: str,
        owner_id: str,
        subject_id: str,
        content_version: str,
        settings_fingerprint: str,
    ) -> Optional[List[Dict[str, Any]]]:
        entry = db.query(RetrievalCacheEntry).filter(RetrievalCacheEntry.cache_key == key).first()
        if entry is None:
            return None
        if (
            entry.owner_id != owner_id
            or entry.subject_id != subject_id
            or entry.content_version != content_version
            or entry.settings_fingerprint != settings_fingerprint
        ):
            return None
        if entry.expires_at <= datetime.datetime.utcnow():
            db.delete(entry)
            db.commit()
            return None
        try:
            value = json.loads(entry.ranked_results)
            return value if isinstance(value, list) else None
        except (TypeError, ValueError):
            db.delete(entry)
            db.commit()
            return None

    def set(
        self,
        db: Session,
        key: str,
        owner_id: str,
        subject_id: str,
        content_version: str,
        settings_fingerprint: str,
        results: List[Dict[str, Any]],
        ttl_seconds: int,
    ) -> None:
        # Callers only pass complete, successfully fused rankings.
        expires_at = datetime.datetime.utcnow() + datetime.timedelta(seconds=max(1, ttl_seconds))
        entry = db.query(RetrievalCacheEntry).filter(RetrievalCacheEntry.cache_key == key).first()
        serialized = json.dumps(results, separators=(",", ":"))
        if entry:
            entry.ranked_results = serialized
            entry.expires_at = expires_at
            entry.content_version = content_version
            entry.settings_fingerprint = settings_fingerprint
        else:
            db.add(RetrievalCacheEntry(
                cache_key=key, owner_id=owner_id, subject_id=subject_id,
                content_version=content_version, settings_fingerprint=settings_fingerprint,
                ranked_results=serialized, expires_at=expires_at,
            ))
        db.commit()

    def invalidate_subject(self, db: Session, subject_id: str) -> None:
        db.query(RetrievalCacheEntry).filter(RetrievalCacheEntry.subject_id == subject_id).delete()
        db.commit()
