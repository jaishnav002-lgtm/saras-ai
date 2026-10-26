"""Mocked coverage for Prompt 4 embedding cache and persistent FAISS behavior."""
from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app.database import Base
from app.services.embedding_cache import InMemoryEmbeddingCache, SQLEmbeddingCache, compute_cache_key
from app.services.exceptions import InvalidResponseError
from app.services.faiss_index import PersistentFaissIndex
from app.services.nemotron import NemotronEmbeddingService


@pytest.fixture
def embedding_settings(tmp_path):
    return Settings(
        nvidia_api_key="test-key-not-for-live-use",
        nvidia_embedding_url="https://example.invalid/v1/embeddings",
        nvidia_embedding_model="nvidia/nemotron-3-embed-1b",
        rag_index_dir=str(tmp_path / "indices"),
        rag_embedding_version="test-v1",
        rag_max_retries=0,
    )


def _success_response(vectors):
    response = MagicMock()
    response.is_success = True
    response.status_code = 200
    response.json.return_value = {
        "data": [{"index": i, "embedding": vector} for i, vector in enumerate(vectors)]
    }
    return response


def test_embedding_cache_hit_miss_and_model_version_separation(embedding_settings):
    cache = InMemoryEmbeddingCache()
    service = NemotronEmbeddingService(settings=embedding_settings, cache=cache)
    with patch("httpx.Client.post", return_value=_success_response([[0.1, 0.2]])) as post:
        assert service.embed_passages(["\r\nSame content\r\n"]) == [[0.1, 0.2]]
        # Same normalized content reuses the successful passage embedding.
        assert service.embed_passages(["Same content"]) == [[0.1, 0.2]]
        assert post.call_count == 1

    key_v1 = compute_cache_key("Same content", service.model_name, "passage", "test-v1")
    key_v2 = compute_cache_key("Same content", service.model_name, "passage", "test-v2")
    key_query = compute_cache_key("Same content", service.model_name, "query", "test-v1")
    assert key_v1 != key_v2 != key_query


def test_invalid_embedding_is_not_cached(embedding_settings):
    cache = InMemoryEmbeddingCache()
    service = NemotronEmbeddingService(settings=embedding_settings, cache=cache)
    with patch("httpx.Client.post", return_value=_success_response([[float("nan"), 0.2]])):
        with pytest.raises(InvalidResponseError):
            service.embed_passages(["invalid vector"])
    key = compute_cache_key("invalid vector", service.model_name, "passage", "test-v1")
    assert cache.get(key) is None


def test_sql_cache_preserves_first_valid_vector(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(f"sqlite:///{tmp_path / 'cache.db'}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        cache = SQLEmbeddingCache(session)
        cache.set("key", [1.0, 2.0], "model", version="v1")
        cache.set("key", [9.0, 9.0], "model", version="v1")
        assert cache.get("key") == [1.0, 2.0]
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def test_faiss_duplicate_mapping_changed_content_and_restart_recovery(tmp_path):
    index = PersistentFaissIndex(str(tmp_path), "subject-a", version="test-v1")
    assert index.sync_chunks(
        ["chunk-1", "chunk-2"], ["hash-1", "hash-2"], [[1.0, 0.0], [0.0, 1.0]]
    ) == 2
    assert index.sync_chunks(["chunk-1"], ["hash-1"], [[1.0, 0.0]]) == 0
    assert index.total_vectors == 2
    # Reindex the same stable chunk ID after its content changed.
    assert index.sync_chunks(["chunk-1"], ["hash-3"], [[0.2, 0.8]]) == 1
    assert index.total_vectors == 2
    assert index.is_consistent()

    restarted = PersistentFaissIndex(str(tmp_path), "subject-a", version="test-v1")
    assert restarted.is_consistent()
    assert restarted.chunk_content_hashes["chunk-1"] == "hash-3"
    assert {row["chunk_id"] for row in restarted.search([0.2, 0.8])} == {"chunk-1", "chunk-2"}
    assert restarted.delete_chunks(["chunk-1"]) == 1
    assert restarted.total_vectors == 1
    assert restarted.search([1.0, 0.0])[0]["chunk_id"] == "chunk-2"


def test_faiss_rejects_invalid_vectors_and_incompatible_metadata(tmp_path):
    index = PersistentFaissIndex(str(tmp_path), "subject-b")
    with pytest.raises(InvalidResponseError):
        index.add_chunks(["bad"], [[float("inf"), 0.0]])
    assert index.add_chunks(["one", "one"], [[1.0, 0.0], [0.0, 1.0]]) == 1
    # A model/version mismatch must not silently use a stale index.
    incompatible = PersistentFaissIndex(str(tmp_path), "subject-b", version="other-version")
    assert incompatible.total_vectors == 0
