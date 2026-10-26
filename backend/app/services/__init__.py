"""
Saras AI backend services.
Modular AI integrations for embeddings, FAISS indexing, caching, and LLM completions.
"""

from app.services.embedding_cache import (
    BaseEmbeddingCache,
    InMemoryEmbeddingCache,
    SQLEmbeddingCache,
    compute_cache_key,
)
from app.services.exceptions import (
    APIResponseError,
    AuthenticationError,
    IngestionError,
    InvalidResponseError,
    RAGServiceError,
    RateLimitError,
    ServiceTimeoutError,
    UnextractableDocumentError,
)
from app.services.faiss_index import (
    FaissIndexManager,
    PersistentFaissIndex,
)
from app.services.groq import GroqGenerationService
from app.services.gemini import GeminiGenerationService
from app.services.nvidia_nim import NvidiaNimGenerationService
from app.services.answering import GroundedAnswerService
from app.services.answer_cache import AnswerCache
from app.services.ingestion import DocumentIngestionService
from app.services.indexing import DocumentEmbeddingIndexer
from app.services.retrieval import HybridRetrievalService, bm25_rank, fuse_rrf
from app.services.retrieval_cache import RetrievalCache
from app.services.nemotron import NemotronEmbeddingService

__all__ = [
    "NemotronEmbeddingService",
    "GroqGenerationService",
    "GeminiGenerationService",
    "NvidiaNimGenerationService",
    "GroundedAnswerService",
    "AnswerCache",
    "DocumentIngestionService",
    "DocumentEmbeddingIndexer",
    "HybridRetrievalService",
    "RetrievalCache",
    "bm25_rank",
    "fuse_rrf",
    "BaseEmbeddingCache",
    "SQLEmbeddingCache",
    "InMemoryEmbeddingCache",
    "compute_cache_key",
    "PersistentFaissIndex",
    "FaissIndexManager",
    "RAGServiceError",
    "AuthenticationError",
    "RateLimitError",
    "ServiceTimeoutError",
    "InvalidResponseError",
    "APIResponseError",
    "IngestionError",
    "UnextractableDocumentError",
]
