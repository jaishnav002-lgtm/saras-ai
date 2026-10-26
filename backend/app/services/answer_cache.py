"""Persistent cache for complete grounded answers and source metadata."""
import datetime
import json
import threading
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models import AnswerCacheEntry


class AnswerCache:
    _locks: Dict[str, threading.Lock] = {}
    _locks_guard = threading.Lock()

    @classmethod
    def lock_for(cls, key: str) -> threading.Lock:
        with cls._locks_guard:
            return cls._locks.setdefault(key, threading.Lock())

    def get(
        self, db: Session, key: str, owner_id: str, subject_id: str,
        source_version: str, settings_fingerprint: str,
    ) -> Optional[Tuple[str, List[Dict[str, Any]]]]:
        entry = db.query(AnswerCacheEntry).filter(AnswerCacheEntry.cache_key == key).first()
        if entry is None:
            return None
        if (
            entry.owner_id != owner_id or entry.subject_id != subject_id
            or entry.source_version != source_version
            or entry.settings_fingerprint != settings_fingerprint
            or entry.expires_at <= datetime.datetime.utcnow()
        ):
            return None
        try:
            sources = json.loads(entry.sources_data)
        except (TypeError, ValueError):
            return None
        if not isinstance(sources, list) or not entry.answer_text.strip():
            return None
        return entry.answer_text, sources

    def set(
        self, db: Session, key: str, owner_id: str, subject_id: str,
        source_version: str, settings_fingerprint: str, answer: str,
        sources: List[Dict[str, Any]], ttl_seconds: int,
    ) -> None:
        if not answer.strip() or not sources:
            return
        expiry = datetime.datetime.utcnow() + datetime.timedelta(seconds=max(1, ttl_seconds))
        entry = db.query(AnswerCacheEntry).filter(AnswerCacheEntry.cache_key == key).first()
        fields = {
            "source_version": source_version, "settings_fingerprint": settings_fingerprint,
            "answer_text": answer, "sources_data": json.dumps(sources, separators=(",", ":")),
            "expires_at": expiry,
        }
        if entry:
            for name, value in fields.items():
                setattr(entry, name, value)
        else:
            db.add(AnswerCacheEntry(cache_key=key, owner_id=owner_id, subject_id=subject_id, **fields))
        db.commit()

    def invalidate_subject(self, db: Session, subject_id: str) -> None:
        db.query(AnswerCacheEntry).filter(AnswerCacheEntry.subject_id == subject_id).delete()
        db.commit()
