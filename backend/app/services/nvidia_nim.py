"""NVIDIA NIM OpenAI-compatible chat client for grounded answers."""
from typing import Any, Dict, List, Optional, Union

import httpx

from app.config import Settings, settings as global_settings
from app.services.exceptions import (
    APIResponseError,
    AuthenticationError,
    InvalidResponseError,
    RateLimitError,
    ServiceTimeoutError,
)


class NvidiaNimGenerationService:
    provider_name = "nvidia-nim"

    def __init__(self, settings: Optional[Settings] = None, timeout: float = 120.0):
        self.settings = settings or global_settings
        self.timeout = timeout

    @property
    def api_key(self) -> Optional[str]:
        return self.settings.nvidia_generation_api_key

    @property
    def endpoint_url(self) -> str:
        return self.settings.nvidia_generation_url

    @property
    def model_name(self) -> str:
        return self.settings.nvidia_generation_model

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
            raise AuthenticationError("NVIDIA_GENERATION_API_KEY is not configured or is empty.")
        context = self._format_context(retrieved_context)
        user_content = (
            f"Context:\n{context}\n\nQuestion:\n{user_question.strip()}"
            if context else user_question.strip()
        )
        payload: Dict[str, Any] = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_instruction.strip()},
                {"role": "user", "content": user_content},
            ],
            "temperature": temperature,
            "stream": False,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    self.endpoint_url,
                    headers={
                        "Authorization": f"Bearer {api_key.strip()}",
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            raise ServiceTimeoutError(
                f"NVIDIA NIM chat completion timed out after {self.timeout}s"
            ) from exc
        except httpx.RequestError as exc:
            raise APIResponseError(
                f"NVIDIA NIM chat completion connection failed: {type(exc).__name__}"
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
            raise AuthenticationError(f"NVIDIA NIM authentication failed (HTTP {response.status_code}): {detail}")
        if response.status_code == 429:
            raise RateLimitError(f"NVIDIA NIM rate limit exceeded (HTTP 429): {detail}")
        raise APIResponseError(f"NVIDIA NIM error (HTTP {response.status_code}): {detail}", response.status_code)

    @staticmethod
    def _parse_response(response: httpx.Response) -> str:
        try:
            body = response.json()
        except Exception as exc:
            raise InvalidResponseError("NVIDIA NIM response is not valid JSON") from exc
        if not isinstance(body, dict):
            raise InvalidResponseError("Malformed NVIDIA NIM response: expected JSON object")
        choices = body.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise InvalidResponseError("Malformed NVIDIA NIM response: missing choices")
        message = choices[0].get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            raise InvalidResponseError("Malformed or empty NVIDIA NIM response text")
        return content.strip()

    @staticmethod
    def _safe_detail(response: httpx.Response, secret: str) -> str:
        try:
            body = response.json()
            detail = body.get("error") if isinstance(body, dict) else response.text
        except Exception:
            detail = response.text
        return " ".join(str(detail).split())[:300].replace(secret, "[REDACTED]")
