from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.config import Settings
from app.services.exceptions import AuthenticationError, InvalidResponseError, RateLimitError, ServiceTimeoutError
from app.services.nvidia_nim import NvidiaNimGenerationService


@pytest.fixture
def nim_service():
    return NvidiaNimGenerationService(Settings(
        nvidia_api_key="embedding-key-must-not-be-used",
        nvidia_generation_api_key="generation-test-secret",
        nvidia_generation_url="https://test.nvidia.api/v1/chat/completions",
        nvidia_generation_model="google/gemma-4-31b-it",
    ))


def _response(payload, status=200):
    response = MagicMock()
    response.status_code = status
    response.is_success = status < 400
    response.json.return_value = payload
    response.text = str(payload)
    return response


def test_nim_generation_uses_separate_key_openai_payload_and_parses_text(nim_service):
    with patch("httpx.Client.post", return_value=_response({
        "choices": [{"message": {"content": "Grounded Gemma answer."}}]
    })) as post:
        assert nim_service.generate("Use context only.", "What happened?", ["Evidence."], 0.1, 50) == "Grounded Gemma answer."
    assert post.call_args.args[0] == "https://test.nvidia.api/v1/chat/completions"
    kwargs = post.call_args.kwargs
    assert kwargs["headers"]["Authorization"] == "Bearer generation-test-secret"
    assert "embedding-key-must-not-be-used" not in str(kwargs["headers"])
    payload = kwargs["json"]
    assert payload["model"] == "google/gemma-4-31b-it"
    assert payload["stream"] is False
    assert payload["messages"][0] == {"role": "system", "content": "Use context only."}
    assert payload["messages"][1]["content"] == "Context:\nEvidence.\n\nQuestion:\nWhat happened?"
    assert payload["max_tokens"] == 50


@pytest.mark.parametrize("status,exception", [(401, AuthenticationError), (429, RateLimitError)])
def test_nim_status_errors_are_safe(nim_service, status, exception):
    with patch("httpx.Client.post", return_value=_response({"error": {"message": "generation-test-secret rejected"}}, status)):
        with pytest.raises(exception) as caught:
            nim_service.generate("Sys", "Question")
    assert "generation-test-secret" not in str(caught.value)


def test_nim_timeout_malformed_and_missing_generation_key(nim_service):
    with patch("httpx.Client.post", side_effect=httpx.TimeoutException("timed out")):
        with pytest.raises(ServiceTimeoutError):
            nim_service.generate("Sys", "Question")
    with patch("httpx.Client.post", return_value=_response({"choices": []})):
        with pytest.raises(InvalidResponseError):
            nim_service.generate("Sys", "Question")
    nim_service.settings.nvidia_generation_api_key = None
    with pytest.raises(AuthenticationError, match="NVIDIA_GENERATION_API_KEY"):
        nim_service.generate("Sys", "Question")
