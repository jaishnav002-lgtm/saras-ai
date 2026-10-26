import math
import os
import sys
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import Settings
from app.services.exceptions import (
    AuthenticationError,
    InvalidResponseError,
    RateLimitError,
    RAGServiceError,
    ServiceTimeoutError,
    APIResponseError,
)
from app.services.nemotron import NemotronEmbeddingService
from app.services.groq import GroqGenerationService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def dummy_settings():
    return Settings(
        nvidia_api_key="nvapi-test-secret-key-123",
        nvidia_embedding_url="https://test.nvidia.api/v1/embeddings",
        nvidia_embedding_model="nvidia/nemotron-3-embed-1b",
        groq_api_key="gsk-test-secret-key-456",
        groq_base_url="https://test.groq.api/openai/v1",
        groq_model="openai/gpt-oss-20b",
    )


@pytest.fixture
def embedding_service(dummy_settings):
    return NemotronEmbeddingService(settings=dummy_settings)


@pytest.fixture
def generation_service(dummy_settings):
    return GroqGenerationService(settings=dummy_settings)


# ---------------------------------------------------------------------------
# Service 1: NemotronEmbeddingService Tests
# ---------------------------------------------------------------------------

def test_embedding_passage_successful(embedding_service):
    """Test successful embedding with input_type='passage'."""
    mock_response_data = {
        "object": "list",
        "data": [
            {"object": "embedding", "embedding": [0.1, 0.2, 0.3], "index": 0},
            {"object": "embedding", "embedding": [0.4, 0.5, 0.6], "index": 1},
        ],
        "model": "nvidia/nemotron-3-embed-1b",
    }

    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = mock_response_data
        mock_post.return_value = mock_resp

        vectors = embedding_service.embed_passages(["Text snippet one", "Text snippet two"])

        assert len(vectors) == 2
        assert vectors[0] == [0.1, 0.2, 0.3]
        assert vectors[1] == [0.4, 0.5, 0.6]

        # Verify request parameters
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args.kwargs
        json_body = call_kwargs["json"]
        assert json_body["input_type"] == "passage"
        assert json_body["model"] == "nvidia/nemotron-3-embed-1b"
        assert json_body["input"] == ["Text snippet one", "Text snippet two"]
        headers = call_kwargs["headers"]
        assert headers["Authorization"] == "Bearer nvapi-test-secret-key-123"


def test_embedding_query_successful(embedding_service):
    """Test successful embedding with input_type='query'."""
    mock_response_data = {
        "object": "list",
        "data": [
            {"object": "embedding", "embedding": [0.9, 0.8, 0.7], "index": 0}
        ],
        "model": "nvidia/nemotron-3-embed-1b",
    }

    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = mock_response_data
        mock_post.return_value = mock_resp

        vector = embedding_service.embed_query("What is Saras AI?")

        assert vector == [0.9, 0.8, 0.7]

        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args.kwargs
        json_body = call_kwargs["json"]
        assert json_body["input_type"] == "query"
        assert json_body["input"] == ["What is Saras AI?"]


def test_embedding_batching_and_response_ordering(embedding_service):
    """Ensure vectors are ordered strictly by input order, even if returned out of order."""
    mock_response_data = {
        "object": "list",
        "data": [
            {"object": "embedding", "embedding": [3.0, 3.1], "index": 2},
            {"object": "embedding", "embedding": [1.0, 1.1], "index": 0},
            {"object": "embedding", "embedding": [2.0, 2.1], "index": 1},
        ],
        "model": "nvidia/nemotron-3-embed-1b",
    }

    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = mock_response_data
        mock_post.return_value = mock_resp

        vectors = embedding_service.embed_passages(["p0", "p1", "p2"])

        assert len(vectors) == 3
        assert vectors[0] == [1.0, 1.1]
        assert vectors[1] == [2.0, 2.1]
        assert vectors[2] == [3.0, 3.1]


def test_embedding_malformed_response_structure(embedding_service):
    """Check that malformed response bodies raise InvalidResponseError."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = {"invalid_key": []}
        mock_post.return_value = mock_resp

        with pytest.raises(InvalidResponseError) as exc_info:
            embedding_service.embed_passages(["test"])
        assert "Missing 'data' field" in str(exc_info.value)


def test_embedding_count_mismatch(embedding_service):
    """Check that missing embeddings count raises InvalidResponseError."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = {
            "data": [{"embedding": [0.1, 0.2], "index": 0}]
        }
        mock_post.return_value = mock_resp

        with pytest.raises(InvalidResponseError) as exc_info:
            embedding_service.embed_passages(["doc1", "doc2"])
        assert "Count mismatch" in str(exc_info.value)


def test_embedding_inconsistent_dimensions(embedding_service):
    """Check that inconsistent vector dimensions raise InvalidResponseError."""
    mock_response_data = {
        "data": [
            {"embedding": [0.1, 0.2, 0.3], "index": 0},
            {"embedding": [0.4, 0.5], "index": 1},  # Length 2 instead of 3
        ]
    }

    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = mock_response_data
        mock_post.return_value = mock_resp

        with pytest.raises(InvalidResponseError) as exc_info:
            embedding_service.embed_passages(["p1", "p2"])
        assert "Inconsistent vector dimension" in str(exc_info.value)


@pytest.mark.parametrize(
    "bad_vector",
    [
        [0.1, "not-a-number", 0.3],
        [0.1, float("nan"), 0.3],
        [0.1, float("inf"), 0.3],
        [0.1, True, 0.3],  # Python bool is int subclass but should be rejected
        [],  # Empty vector
    ],
)
def test_embedding_non_numeric_or_non_finite_values(embedding_service, bad_vector):
    """Check that non-numeric, non-finite, boolean, or empty vectors raise InvalidResponseError."""
    mock_response_data = {
        "data": [
            {"embedding": bad_vector, "index": 0}
        ]
    }

    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = mock_response_data
        mock_post.return_value = mock_resp

        with pytest.raises(InvalidResponseError):
            embedding_service.embed_passages(["p1"])


def test_embedding_authentication_failure_401(embedding_service):
    """HTTP 401 raises AuthenticationError without logging credentials."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.is_success = False
        mock_resp.text = '{"error": "Invalid API Key"}'
        mock_post.return_value = mock_resp

        with pytest.raises(AuthenticationError) as exc_info:
            embedding_service.embed_query("test query")

        assert "Authentication failed" in str(exc_info.value)
        # Ensure secret is NOT in the error message
        assert "nvapi-test-secret-key-123" not in str(exc_info.value)


def test_embedding_authorization_failure_403(embedding_service):
    """HTTP 403 raises AuthenticationError (forbidden/access denied)."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.is_success = False
        mock_resp.text = '{"error": "Forbidden: Model access not granted"}'
        mock_post.return_value = mock_resp

        with pytest.raises(AuthenticationError) as exc_info:
            embedding_service.embed_passages(["test"])

        assert "403" in str(exc_info.value)
        assert "nvapi-test-secret-key-123" not in str(exc_info.value)


def test_embedding_rate_limit_429(embedding_service):
    """HTTP 429 raises RateLimitError."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.is_success = False
        mock_resp.text = '{"error": "Too Many Requests"}'
        mock_post.return_value = mock_resp

        with pytest.raises(RateLimitError) as exc_info:
            embedding_service.embed_query("test query")

        assert "Rate limit exceeded" in str(exc_info.value)


def test_embedding_timeout(embedding_service):
    """Timeout exception raises ServiceTimeoutError."""
    with patch("httpx.Client.post") as mock_post:
        mock_post.side_effect = httpx.TimeoutException("Read timeout after 30.0s")

        with pytest.raises(ServiceTimeoutError) as exc_info:
            embedding_service.embed_query("test query")

        assert "timed out" in str(exc_info.value).lower()


def test_embedding_missing_api_key(dummy_settings):
    """Missing API key raises AuthenticationError immediately before network call."""
    dummy_settings.nvidia_api_key = None
    service = NemotronEmbeddingService(settings=dummy_settings)

    with pytest.raises(AuthenticationError) as exc_info:
        service.embed_query("test")
    assert "NVIDIA_API_KEY is not configured" in str(exc_info.value)


def test_embedding_empty_input(embedding_service):
    """Empty list returns empty list without calling API."""
    with patch("httpx.Client.post") as mock_post:
        result = embedding_service.embed_passages([])
        assert result == []
        mock_post.assert_not_called()


# ---------------------------------------------------------------------------
# Service 2: GroqGenerationService Tests
# ---------------------------------------------------------------------------

def test_groq_generation_successful(generation_service):
    """Test successful Groq chat completion returning text only."""
    mock_response_data = {
        "id": "chatcmpl-123",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "This is the generated assistant answer.",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 50, "completion_tokens": 10, "total_tokens": 60},
    }

    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = mock_response_data
        mock_post.return_value = mock_resp

        answer = generation_service.generate(
            system_instruction="You are a helpful study tutor.",
            user_question="Explain Dijkstra algorithm.",
            retrieved_context="Dijkstra algorithm finds shortest paths in a graph.",
        )

        assert answer == "This is the generated assistant answer."
        assert isinstance(answer, str)

        # Inspect request
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args.kwargs
        json_body = call_kwargs["json"]
        assert json_body["model"] == "openai/gpt-oss-20b"
        messages = json_body["messages"]
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "You are a helpful study tutor."
        assert messages[1]["role"] == "user"
        assert "Dijkstra algorithm finds shortest paths in a graph." in messages[1]["content"]
        assert "Explain Dijkstra algorithm." in messages[1]["content"]

        headers = call_kwargs["headers"]
        assert headers["Authorization"] == "Bearer gsk-test-secret-key-456"


def test_groq_generation_without_context(generation_service):
    """Generation works when retrieved_context is empty or None."""
    mock_response_data = {
        "choices": [
            {
                "message": {"role": "assistant", "content": "Hello! How can I help?"}
            }
        ]
    }

    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = mock_response_data
        mock_post.return_value = mock_resp

        answer = generation_service.generate(
            system_instruction="Be concise.",
            user_question="Hi",
            retrieved_context=None,
        )

        assert answer == "Hello! How can I help?"
        messages = mock_post.call_args.kwargs["json"]["messages"]
        assert messages[1]["content"] == "Hi"


def test_groq_authentication_failure(generation_service):
    """HTTP 401 raises AuthenticationError without exposing API key."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.is_success = False
        mock_resp.text = '{"error": {"message": "Invalid API Key"}}'
        mock_post.return_value = mock_resp

        with pytest.raises(AuthenticationError) as exc_info:
            generation_service.generate(
                system_instruction="Sys",
                user_question="Q",
            )

        assert "Authentication failed" in str(exc_info.value)
        assert "gsk-test-secret-key-456" not in str(exc_info.value)


def test_groq_rate_limit(generation_service):
    """HTTP 429 raises RateLimitError."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.is_success = False
        mock_resp.text = '{"error": {"message": "Rate limit exceeded"}}'
        mock_post.return_value = mock_resp

        with pytest.raises(RateLimitError) as exc_info:
            generation_service.generate(
                system_instruction="Sys",
                user_question="Q",
            )

        assert "Rate limit exceeded" in str(exc_info.value)


def test_groq_timeout(generation_service):
    """Timeout exception raises ServiceTimeoutError."""
    with patch("httpx.Client.post") as mock_post:
        mock_post.side_effect = httpx.TimeoutException("Groq timed out")

        with pytest.raises(ServiceTimeoutError) as exc_info:
            generation_service.generate(
                system_instruction="Sys",
                user_question="Q",
            )

        assert "timed out" in str(exc_info.value).lower()


def test_groq_malformed_response_missing_choices(generation_service):
    """Malformed response without 'choices' raises InvalidResponseError."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = {"error": "unexpected format"}
        mock_post.return_value = mock_resp

        with pytest.raises(InvalidResponseError) as exc_info:
            generation_service.generate(
                system_instruction="Sys",
                user_question="Q",
            )

        assert "Missing or empty 'choices'" in str(exc_info.value)


def test_groq_malformed_response_empty_choices(generation_service):
    """Empty choices list raises InvalidResponseError."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.is_success = True
        mock_resp.json.return_value = {"choices": []}
        mock_post.return_value = mock_resp

        with pytest.raises(InvalidResponseError):
            generation_service.generate(
                system_instruction="Sys",
                user_question="Q",
            )


def test_groq_api_error_500(generation_service):
    """HTTP 500 raises APIResponseError."""
    with patch("httpx.Client.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.is_success = False
        mock_resp.text = '{"error": {"message": "Internal server error"}}'
        mock_post.return_value = mock_resp

        with pytest.raises(APIResponseError) as exc_info:
            generation_service.generate(
                system_instruction="Sys",
                user_question="Q",
            )

        assert "500" in str(exc_info.value)


def test_groq_missing_api_key(dummy_settings):
    """Missing Groq API key raises AuthenticationError."""
    dummy_settings.groq_api_key = None
    service = GroqGenerationService(settings=dummy_settings)

    with pytest.raises(AuthenticationError) as exc_info:
        service.generate(system_instruction="Sys", user_question="Q")
    assert "GROQ_API_KEY is not configured" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Startup & Import Safety: Confirmation of No External API Calls
# ---------------------------------------------------------------------------

def test_imports_and_startup_make_no_external_calls():
    """Verify that importing modules and starting the app performs NO external HTTP calls."""
    with patch("httpx.Client.post") as mock_post, \
         patch("httpx.Client.get") as mock_get, \
         patch("httpx.post") as mock_fn_post, \
         patch("httpx.get") as mock_fn_get:

        # Re-import modules to ensure module level code runs during test
        import app.config  # noqa: F401
        import app.main    # noqa: F401
        import app.services.nemotron  # noqa: F401
        import app.services.groq      # noqa: F401

        # Instantiate services with default settings
        s1 = NemotronEmbeddingService()
        s2 = GroqGenerationService()
        assert s1 is not None
        assert s2 is not None

        # Verify no network calls were made
        mock_post.assert_not_called()
        mock_get.assert_not_called()
        mock_fn_post.assert_not_called()
        mock_fn_get.assert_not_called()
