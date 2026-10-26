import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base
from app.models import Document, DocumentChunk, Subject, User
from app.services.backfill import DocumentIndexBackfill
from app.services.faiss_index import FaissIndexManager
from app.services.indexing import DocumentEmbeddingIndexer


class FakeEmbeddingService:
    def __init__(self):
        self.calls = 0

    def embed_passages(self, passages, db=None):
        self.calls += 1
        return [[1.0, 0.0] for _ in passages]


def test_backfill_indexes_incomplete_chunks_idempotently_and_removes_orphans(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'backfill.db'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        settings = Settings(
            database_url=f"sqlite:///{tmp_path / 'backfill.db'}",
            rag_index_dir=str(tmp_path / "indices"),
            rag_embedding_version="test-v1",
        )
        user = User(name="Owner", email="backfill@example.test", password_hash="x")
        session.add(user)
        session.commit()
        subject = Subject(user_id=user.id, name="Systems")
        session.add(subject)
        session.commit()
        document = Document(
            subject_id=subject.id,
            filename="systems.pdf",
            file_type="pdf",
            storage_path=str(tmp_path / "unneeded-because-chunks-exist.pdf"),
            status="failed",
            error_message="embedding unavailable",
        )
        session.add(document)
        session.commit()
        chunk = DocumentChunk(
            id=str(uuid.uuid4()), document_id=document.id, subject_id=subject.id,
            owner_id=user.id, filename=document.filename, page_number=3, chunk_index=0,
            content="Mutexes prevent conflicting critical-section access.",
            content_hash="mutex-v1", status="ingested",
        )
        session.add(chunk)
        session.commit()

        fake = FakeEmbeddingService()
        manager = FaissIndexManager(settings)
        indexer = DocumentEmbeddingIndexer(settings, embedding_service=fake, index_manager=manager)
        backfill = DocumentIndexBackfill(settings, indexer=indexer)

        first = backfill.run(session)
        session.refresh(document)
        session.refresh(chunk)
        assert first.indexed_chunks == 1
        assert first.failures == []
        assert fake.calls == 1
        assert document.status == "processed"
        assert document.error_message is None
        assert chunk.status == "indexed"
        assert manager.get_index(subject.id).chunk_ids == [chunk.id]

        second = backfill.run(session)
        assert second.current_documents == 1
        assert second.indexed_chunks == 0
        assert fake.calls == 1

        manager.get_index(subject.id).sync_chunks(["orphan"], ["orphan-v1"], [[0.0, 1.0]])
        cleanup = backfill.run(session)
        assert cleanup.orphan_vectors_removed == 1
        assert manager.get_index(subject.id).chunk_ids == [chunk.id]
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def test_backfill_dry_run_reports_counts_without_mutating_state(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'backfill_dry.db'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        settings = Settings(
            database_url=f"sqlite:///{tmp_path / 'backfill_dry.db'}",
            rag_index_dir=str(tmp_path / "indices"),
            rag_embedding_version="test-v1",
        )
        user = User(name="Owner", email="dryrun@example.test", password_hash="x")
        session.add(user)
        session.commit()
        subject = Subject(user_id=user.id, name="Algorithms")
        session.add(subject)
        session.commit()
        document = Document(
            subject_id=subject.id,
            filename="algo.pdf",
            file_type="pdf",
            storage_path=str(tmp_path / "algo.pdf"),
            status="failed",
            error_message="embedding timed out",
        )
        session.add(document)
        session.commit()
        chunk = DocumentChunk(
            id=str(uuid.uuid4()), document_id=document.id, subject_id=subject.id,
            owner_id=user.id, filename=document.filename, page_number=1, chunk_index=0,
            content="Binary search achieves logarithmic time complexity.",
            content_hash="search-v1", status="ingested",
        )
        session.add(chunk)
        session.commit()

        fake = FakeEmbeddingService()
        manager = FaissIndexManager(settings)
        manager.get_index(subject.id).sync_chunks(["orphan-vector"], ["orph-v1"], [[0.0, 1.0]])

        indexer = DocumentEmbeddingIndexer(settings, embedding_service=fake, index_manager=manager)
        backfill = DocumentIndexBackfill(settings, indexer=indexer)

        # 1. Dry run should observe missing chunks and orphan vectors but make no changes
        dry_report = backfill.run(session, dry_run=True)
        session.refresh(document)
        session.refresh(chunk)

        assert dry_report.scanned_documents == 1
        assert dry_report.current_documents == 0
        assert dry_report.missing_chunks == 1
        assert dry_report.stale_chunks == 0
        assert dry_report.already_indexed_chunks == 0
        assert dry_report.orphan_vectors_detected == 1
        assert dry_report.orphan_vectors_removed == 0
        assert dry_report.indexed_chunks == 0
        assert dry_report.failures == []
        assert fake.calls == 0

        # State must be completely unmodified
        assert document.status == "failed"
        assert document.error_message == "embedding timed out"
        assert chunk.status == "ingested"
        assert manager.get_index(subject.id).chunk_ids == ["orphan-vector"]

        # 2. Executing write run should safely index missing chunk and clean orphan
        write_report = backfill.run(session, dry_run=False)
        session.refresh(document)
        session.refresh(chunk)

        assert write_report.indexed_chunks == 1
        assert write_report.orphan_vectors_removed == 1
        assert fake.calls == 1
        assert document.status == "processed"
        assert document.error_message is None
        assert chunk.status == "indexed"
        assert manager.get_index(subject.id).chunk_ids == [chunk.id]
    finally:
        session.close()
        Base.metadata.drop_all(engine)

