"""Google Gemini REST client for grounded answer generation."""
from typing import Any, Dict, List, Optional, Union
from urllib.parse import quote

import httpx

from app.config import Settings, settings as global_settings
from app.services.exceptions import (
    APIResponseError,
    AuthenticationError,
    InvalidResponseError,
    RateLimitError,
    ServiceTimeoutError,
)


class GeminiGenerationService:
    provider_name = "google-gemini"

    def __init__(self, settings: Optional[Settings] = None, timeout: float = 60.0):
        self.settings = settings or global_settings
        self.timeout = timeout

    @property
    def api_key(self) -> Optional[str]:
        return self.settings.gemini_api_key

    @property
    def model_name(self) -> str:
        return self.settings.gemini_model

    @property
    def generate_url(self) -> str:
        model = self.model_name.removeprefix("models/")
        base = self.settings.gemini_api_base_url.rstrip("/")
        return f"{base}/models/{quote(model, safe='')}:generateContent"

    def generate(
        self,
        system_instruction: str,
        user_question: str,
        retrieved_context: Optional[Union[str, List[str]]] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
    ) -> str:
        api_key = self.api_key
        if not api_key or not api_key.strip():
            raise AuthenticationError("GEMINI_API_KEY is not configured or is empty.")

        context = self._format_context(retrieved_context)
        prompt = (
            f"Context:\n{context}\n\nQuestion:\n{user_question.strip()}"
            if context else user_question.strip()
        )
        generation_config: Dict[str, Any] = {"temperature": temperature}
        if max_tokens is not None:
            generation_config["maxOutputTokens"] = max_tokens
        payload = {
            "systemInstruction": {"parts": [{"text": system_instruction.strip()}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": generation_config,
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    self.generate_url,
                    headers={
                        "x-goog-api-key": api_key.strip(),
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            raise ServiceTimeoutError(
                f"Gemini generateContent request timed out after {self.timeout}s"
            ) from exc
        except httpx.RequestError as exc:
            raise APIResponseError(
                f"Gemini generateContent connection failed: {type(exc).__name__}"
            ) from exc

        if not response.is_success:
            self._handle_error(response, api_key)
        return self._parse_response(response)

    @staticmethod
    def _format_context(retrieved_context: Optional[Union[str, List[str]]]) -> str:
        if isinstance(retrieved_context, list):
            return "\n\n".join(str(item).strip() for item in retrieved_context if item).strip()
        return retrieved_context.strip() if isinstance(retrieved_context, str) else ""

    def _handle_error(self, response: httpx.Response, api_key: str) -> None:
        detail = self._safe_detail(response, api_key)
        if response.status_code in (401, 403):
            raise AuthenticationError(f"Gemini API authentication failed (HTTP {response.status_code}): {detail}")
        if response.status_code == 429:
            raise RateLimitError(f"Gemini API rate limit exceeded (HTTP 429): {detail}")
        raise APIResponseError(f"Gemini API error (HTTP {response.status_code}): {detail}", response.status_code)

    @staticmethod
    def _parse_response(response: httpx.Response) -> str:
        try:
            body = response.json()
        except Exception as exc:
            raise InvalidResponseError("Gemini API response is not valid JSON") from exc
        if not isinstance(body, dict):
            raise InvalidResponseError("Malformed Gemini API response: expected JSON object")
        candidates = body.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            raise InvalidResponseError("Malformed or blocked Gemini response: missing candidates")
        candidate = candidates[0]
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            raise InvalidResponseError("Malformed Gemini response: candidate missing content parts")
        text = "".join(part.get("text", "") for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str)).strip()
        if not text:
            raise InvalidResponseError("Malformed or empty Gemini response text")
        return text

    @staticmethod
    def _safe_detail(response: httpx.Response, secret: str) -> str:
        try:
            body = response.json()
            detail = body.get("error") if isinstance(body, dict) else response.text
        except Exception:
            detail = response.text
        safe = " ".join(str(detail).split())[:300]
        return safe.replace(secret, "[REDACTED]")
