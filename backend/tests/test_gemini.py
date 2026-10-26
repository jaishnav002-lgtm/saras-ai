from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.config import Settings
from app.services.exceptions import AuthenticationError, InvalidResponseError, RateLimitError, ServiceTimeoutError
from app.services.gemini import GeminiGenerationService


@pytest.fixture
def gemini_service():
    return GeminiGenerationService(Settings(
        gemini_api_key="gemini-test-secret",
        gemini_api_base_url="https://test.googleapis.com/v1beta",
        gemini_model="gemini-test-model",
    ))


def _response(payload, status=200):
    response = MagicMock()
    response.status_code = status
    response.is_success = status < 400
    response.json.return_value = payload
    response.text = str(payload)
    return response


def test_gemini_generate_uses_google_request_and_parses_text(gemini_service):
    payload = {"candidates": [{"content": {"parts": [{"text": "Grounded answer."}]}}]}
    with patch("httpx.Client.post", return_value=_response(payload)) as post:
        answer = gemini_service.generate("Use context only.", "What happened?", ["Evidence."], 0.1, 50)
    assert answer == "Grounded answer."
    kwargs = post.call_args.kwargs
    assert post.call_args.args[0].endswith("/models/gemini-test-model:generateContent")
    assert kwargs["headers"]["x-goog-api-key"] == "gemini-test-secret"
    assert "Authorization" not in kwargs["headers"]
    payload = kwargs["json"]
    assert payload["systemInstruction"]["parts"][0]["text"] == "Use context only."
    assert payload["contents"][0]["parts"][0]["text"] == "Context:\nEvidence.\n\nQuestion:\nWhat happened?"
    assert payload["generationConfig"] == {"temperature": 0.1, "maxOutputTokens": 50}


@pytest.mark.parametrize("status,exception", [(401, AuthenticationError), (429, RateLimitError)])
def test_gemini_status_errors_are_safe(gemini_service, status, exception):
    with patch("httpx.Client.post", return_value=_response({"error": {"message": "gemini-test-secret rejected"}}, status)):
        with pytest.raises(exception) as caught:
            gemini_service.generate("Sys", "Question")
    assert "gemini-test-secret" not in str(caught.value)


def test_gemini_timeout_and_malformed_response(gemini_service):
    with patch("httpx.Client.post", side_effect=httpx.TimeoutException("timed out")):
        with pytest.raises(ServiceTimeoutError):
            gemini_service.generate("Sys", "Question")
    with patch("httpx.Client.post", return_value=_response({"candidates": []})):
        with pytest.raises(InvalidResponseError):
            gemini_service.generate("Sys", "Question")


def test_gemini_missing_key(gemini_service):
    gemini_service.settings.gemini_api_key = None
    with pytest.raises(AuthenticationError, match="GEMINI_API_KEY"):
        gemini_service.generate("Sys", "Question")
