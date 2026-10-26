import datetime
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base
from app.models import Document, DocumentChunk, RetrievalCacheEntry, Subject, User
from app.services.faiss_index import FaissIndexManager
from app.services.retrieval import HybridRetrievalService, bm25_rank, fuse_rrf, tokenize_for_bm25
from app.services.retrieval_cache import RetrievalCache


class FakeEmbeddingService:
    model_name = "nvidia/nemotron-3-embed-1b"

    def __init__(self):
        self.calls = 0

    def embed_query(self, text, db=None):
        self.calls += 1
        return [1.0, 0.0]


@pytest.fixture
def retrieval_env(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'retrieval.db'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'retrieval.db'}",
        rag_index_dir=str(tmp_path / "indices"),
        rag_embedding_version="test-v1",
        rag_top_k=3,
        rag_rrf_k=60,
        rag_retrieval_cache_ttl_seconds=600,
    )
    try:
        owner = User(name="Owner", email="owner@example.test", password_hash="x")
        other = User(name="Other", email="other@example.test", password_hash="x")
        session.add_all([owner, other])
        session.commit()
        subject = Subject(user_id=owner.id, name="Networks")
        other_subject = Subject(user_id=other.id, name="Private")
        session.add_all([subject, other_subject])
        session.commit()
        document = Document(subject_id=subject.id, filename="networks.pdf", file_type="pdf", storage_path="x")
        session.add(document)
        session.commit()
        chunks = [
            DocumentChunk(id=str(uuid.uuid4()), document_id=document.id, subject_id=subject.id, owner_id=owner.id,
                          filename="networks.pdf", page_number=1, chunk_index=0,
                          content="TCP/IP RFC-793 uses sequence-number ACK fields.", content_hash="h-tcp", status="indexed"),
            DocumentChunk(id=str(uuid.uuid4()), document_id=document.id, subject_id=subject.id, owner_id=owner.id,
                          filename="networks.pdf", page_number=2, chunk_index=1,
                          content="The Big-O formula O(n log n) describes sorting complexity.", content_hash="h-formula", status="indexed"),
        ]
        session.add_all(chunks)
        session.commit()
        yield session, settings, owner, other, subject, chunks
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _service(settings):
    fake = FakeEmbeddingService()
    manager = FaissIndexManager(settings)
    index = manager.get_index  # keep manager explicit for test-controlled vectors
    return HybridRetrievalService(settings, fake, manager), fake, index


def _populate_index(manager_get, subject_id, chunks):
    index = manager_get(subject_id)
    index.sync_chunks(
        [chunk.id for chunk in chunks], [chunk.content_hash for chunk in chunks],
        [[1.0, 0.0], [0.0, 1.0]],
    )


def test_bm25_preserves_technical_terms_and_rrf_deduplicates(retrieval_env):
    session, settings, owner, _, subject, chunks = retrieval_env
    assert "tcp/ip" in tokenize_for_bm25("TCP/IP RFC-793")
    assert "o(n" in tokenize_for_bm25("O(n log n)")
    ranked = bm25_rank("TCP/IP RFC-793", chunks, 3)
    assert ranked[0]["chunk_id"] == chunks[0].id
    fused = fuse_rrf(
        [{"chunk_id": chunks[0].id, "score": .9}, {"chunk_id": chunks[1].id, "score": .2}],
        [{"chunk_id": chunks[0].id, "score": 2.0}], 60, 3,
    )
    assert [row["chunk_id"] for row in fused] == [chunks[0].id, chunks[1].id]
    assert fused[0]["semantic_rank"] == 1 and fused[0]["keyword_rank"] == 1


def test_hybrid_faiss_bm25_cache_and_content_version_invalidation(retrieval_env):
    session, settings, owner, _, subject, chunks = retrieval_env
    service, fake, manager_get = _service(settings)
    _populate_index(manager_get, subject.id, chunks)

    first, cached = service.retrieve("What is TCP/IP RFC-793?", subject.id, owner.id, session)
    assert not cached and first[0]["chunk_id"] == chunks[0].id
    assert first[0]["content"] == chunks[0].content
    second, cached = service.retrieve("  What is TCP/IP RFC-793?  ", subject.id, owner.id, session)
    assert cached and [row["chunk_id"] for row in second] == [row["chunk_id"] for row in first]
    assert fake.calls == 1

    chunks[0].content_hash = "h-tcp-changed"
    session.commit()
    third, cached = service.retrieve("What is TCP/IP RFC-793?", subject.id, owner.id, session)
    assert not cached and third[0]["chunk_id"] == chunks[0].id
    assert fake.calls == 2


def test_cache_expiry_empty_results_and_cross_user_authorization(retrieval_env):
    session, settings, owner, other, subject, chunks = retrieval_env
    service, fake, manager_get = _service(settings)

    empty, cached = service.retrieve("unfindable_identifier_987", subject.id, owner.id, session)
    assert empty == [] and not cached
    cached_empty, cached = service.retrieve("unfindable_identifier_987", subject.id, owner.id, session)
    assert cached and cached_empty == []
    entry = session.query(RetrievalCacheEntry).first()
    entry.expires_at = datetime.datetime.utcnow() - datetime.timedelta(seconds=1)
    session.commit()
    _, cached = service.retrieve("unfindable_identifier_987", subject.id, owner.id, session)
    assert not cached

    with pytest.raises(PermissionError):
        service.retrieve("TCP/IP", subject.id, other.id, session)


def test_subject_cache_invalidation_for_document_lifecycle(retrieval_env):
    session, settings, owner, _, subject, chunks = retrieval_env
    service, _, manager_get = _service(settings)
    _populate_index(manager_get, subject.id, chunks)
    service.retrieve("TCP/IP", subject.id, owner.id, session)
    assert session.query(RetrievalCacheEntry).count() == 1

    # The document deletion path invokes this same subject invalidation.
    RetrievalCache().invalidate_subject(session, subject.id)
    assert session.query(RetrievalCacheEntry).count() == 0
