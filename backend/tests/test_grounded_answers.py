import datetime
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base
from app.models import AnswerCacheEntry, Document, DocumentChunk, Subject, User
from app.services.answering import GroundedAnswerService, INSUFFICIENT_EVIDENCE_ANSWER
from app.services.exceptions import APIResponseError, InvalidResponseError, RateLimitError, ServiceTimeoutError


class FakeRetriever:
    def __init__(self, rows):
        self.rows = rows
        self.calls = 0

    def retrieve(self, question, subject_id, user_id, db, top_k=None):
        self.calls += 1
        return self.rows, False


class FakeGenerator:
    def __init__(self, answer="TCP uses sequence numbers.", error=None):
        self.answer = answer
        self.error = error
        self.calls = 0
        self.request = None

    def generate(self, **kwargs):
        self.calls += 1
        self.request = kwargs
        if self.error:
            raise self.error
        return self.answer


@pytest.fixture
def answer_env(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'answers.db'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'answers.db'}",
        rag_answer_cache_ttl_seconds=900,
        rag_answer_prompt_version="test-v1",
        nvidia_generation_model="google/gemma-4-31b-it",
    )
    try:
        owner = User(name="Owner", email="answer-owner@example.test", password_hash="x")
        other = User(name="Other", email="answer-other@example.test", password_hash="x")
        session.add_all([owner, other])
        session.commit()
        subject = Subject(user_id=owner.id, name="Networks")
        session.add(subject)
        session.commit()
        document = Document(subject_id=subject.id, filename="tcp.pdf", file_type="pdf", storage_path="x")
        session.add(document)
        session.commit()
        chunk = DocumentChunk(
            id=str(uuid.uuid4()), document_id=document.id, subject_id=subject.id, owner_id=owner.id,
            filename="tcp.pdf", page_number=7, chunk_index=0,
            content="TCP uses sequence numbers to order bytes.", content_hash="tcp-v1", status="indexed",
        )
        session.add(chunk)
        session.commit()
        row = {
            "chunk_id": chunk.id, "document_id": document.id, "filename": chunk.filename,
            "page_number": chunk.page_number, "chunk_index": chunk.chunk_index,
            "content": chunk.content, "score": 0.03,
        }
        yield session, settings, owner, other, subject, chunk, row
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def test_grounded_answer_preserves_sources_and_hits_cache(answer_env):
    session, settings, owner, _, subject, chunk, row = answer_env
    retriever, generator = FakeRetriever([row]), FakeGenerator()
    service = GroundedAnswerService(settings, retriever, generator)

    answer, sources, cached = service.answer("How does TCP order bytes?", subject.id, owner.id, session)
    assert answer == "TCP uses sequence numbers."
    assert not cached
    assert sources == [{
        "chunk_id": chunk.id, "document_id": chunk.document_id, "subject_id": subject.id,
        "filename": "tcp.pdf", "page_number": 7,
    }]
    assert "TCP uses sequence numbers" in generator.request["retrieved_context"][0]
    assert "only from the supplied retrieved context" in generator.request["system_instruction"]

    _, cached_sources, cached = service.answer("  How does TCP order bytes? ", subject.id, owner.id, session)
    assert cached and cached_sources == sources and generator.calls == 1


def test_empty_or_unauthorized_sources_do_not_call_or_cache_provider(answer_env):
    session, settings, owner, other, subject, chunk, row = answer_env
    empty_generator = FakeGenerator()
    answer, sources, cached = GroundedAnswerService(settings, FakeRetriever([]), empty_generator).answer(
        "unknown", subject.id, owner.id, session
    )
    assert (answer, sources, cached) == (INSUFFICIENT_EVIDENCE_ANSWER, [], False)
    assert empty_generator.calls == 0

    unauthorized_generator = FakeGenerator()
    answer, sources, cached = GroundedAnswerService(settings, FakeRetriever([row]), unauthorized_generator).answer(
        "TCP", subject.id, other.id, session
    )
    assert (answer, sources, cached) == (INSUFFICIENT_EVIDENCE_ANSWER, [], False)
    assert unauthorized_generator.calls == 0
    assert session.query(AnswerCacheEntry).count() == 0


def test_answer_cache_expiry_source_and_prompt_version_invalidate(answer_env):
    session, settings, owner, _, subject, chunk, row = answer_env
    generator = FakeGenerator()
    service = GroundedAnswerService(settings, FakeRetriever([row]), generator)
    service.answer("TCP?", subject.id, owner.id, session)
    entry = session.query(AnswerCacheEntry).one()
    entry.expires_at = datetime.datetime.utcnow() - datetime.timedelta(seconds=1)
    session.commit()
    service.answer("TCP?", subject.id, owner.id, session)
    assert generator.calls == 2

    chunk.content_hash = "tcp-v2"
    session.commit()
    service.answer("TCP?", subject.id, owner.id, session)
    assert generator.calls == 3

    settings.rag_answer_prompt_version = "test-v2"
    service.answer("TCP?", subject.id, owner.id, session)
    assert generator.calls == 4

    settings.nvidia_generation_model = "google/gemma-4-31b-it-v2"
    service.answer("TCP?", subject.id, owner.id, session)
    assert generator.calls == 5


@pytest.mark.parametrize("error", [
    ServiceTimeoutError("timeout"), RateLimitError("rate limited"),
    APIResponseError("provider failure"), InvalidResponseError("malformed"),
])
def test_failed_or_malformed_generation_is_never_cached(answer_env, error):
    session, settings, owner, _, subject, chunk, row = answer_env
    service = GroundedAnswerService(settings, FakeRetriever([row]), FakeGenerator(error=error))
    with pytest.raises(type(error)):
        service.answer("TCP?", subject.id, owner.id, session)
    assert session.query(AnswerCacheEntry).count() == 0
