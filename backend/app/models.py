import uuid
import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    subjects = relationship("Subject", back_populates="owner", cascade="all, delete-orphan")


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    owner = relationship("User", back_populates="subjects")
    documents = relationship("Document", back_populates="subject", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    subject_id = Column(UUID(as_uuid=False), ForeignKey("subjects.id"), nullable=False)
    filename = Column(String, nullable=False)
    file_type = Column(String, nullable=False)  # pdf | pptx | docx
    storage_path = Column(String, nullable=False)
    status = Column(String, default="uploaded")  # uploaded -> processing -> processed | failed
    page_or_slide_count = Column(Integer, nullable=True)
    extracted_preview = Column(Text, nullable=True)  # first ~1000 chars of extracted text
    extracted_text = Column(Text, nullable=True)  # full extracted text
    error_message = Column(String, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)

    subject = relationship("Subject", back_populates="documents")
    chunks = relationship(
        "DocumentChunk",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DocumentChunk.chunk_index",
    )


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    document_id = Column(UUID(as_uuid=False), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = Column(UUID(as_uuid=False), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    page_number = Column(Integer, nullable=True)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    content_hash = Column(String(64), nullable=False, index=True)
    token_count = Column(Integer, nullable=True)
    status = Column(String, default="ingested", nullable=False)  # ingested | pending_embedding | indexed
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_document_chunk_index"),
    )

    document = relationship("Document", back_populates="chunks")


class EmbeddingCacheEntry(Base):
    __tablename__ = "embedding_cache"

    cache_key = Column(String(64), primary_key=True)  # SHA-256 of version + model + input_type + content
    model = Column(String, nullable=False)
    input_type = Column(String, nullable=False)
    version = Column(String, default="v1", nullable=False)
    dim = Column(Integer, nullable=False)
    vector_data = Column(Text, nullable=False)  # JSON-encoded list of floats
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class RetrievalCacheEntry(Base):
    """Persistent cache of ranked IDs only; document content is never copied here."""
    __tablename__ = "retrieval_cache"

    cache_key = Column(String(64), primary_key=True)
    owner_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = Column(UUID(as_uuid=False), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    content_version = Column(String(64), nullable=False, index=True)
    settings_fingerprint = Column(String(64), nullable=False)
    ranked_results = Column(Text, nullable=False)  # JSON IDs and rank metadata; never chunk content
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AnswerCacheEntry(Base):
    """Persistent, authorized answer cache; sources never include chunk text."""
    __tablename__ = "answer_cache"

    cache_key = Column(String(64), primary_key=True)
    owner_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = Column(UUID(as_uuid=False), ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    source_version = Column(String(64), nullable=False, index=True)
    settings_fingerprint = Column(String(64), nullable=False)
    answer_text = Column(Text, nullable=False)
    sources_data = Column(Text, nullable=False)  # JSON source metadata only; never chunks
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
