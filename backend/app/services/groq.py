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


class GroqGenerationService:
    """
    Modular client for Groq OpenAI-compatible chat completions.
    Formats system instruction, retrieved context, and user question,
    invokes the configured endpoint, and returns generated assistant text only.
    """

    def __init__(
        self,
        settings: Optional[Settings] = None,
        timeout: float = 60.0,
    ):
        self.settings = settings or global_settings
        self.timeout = timeout

    @property
    def api_key(self) -> Optional[str]:
        return self.settings.groq_api_key

    @property
    def base_url(self) -> str:
        return self.settings.groq_base_url.rstrip("/")

    @property
    def model_name(self) -> str:
        return self.settings.groq_model

    @property
    def completions_url(self) -> str:
        # Standard OpenAI-compatible path
        if self.base_url.endswith("/chat/completions"):
            return self.base_url
        return f"{self.base_url}/chat/completions"

    def generate(
        self,
        system_instruction: str,
        user_question: str,
        retrieved_context: Optional[Union[str, List[str]]] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
    ) -> str:
        """
        Executes a chat completion call and returns assistant text only.
        Does not fabricate citations or alter context; passes inputs cleanly.
        """
        api_key = self.api_key
        if not api_key or not api_key.strip():
            raise AuthenticationError("GROQ_API_KEY is not configured or is empty.")

        messages = self._build_messages(
            system_instruction=system_instruction,
            user_question=user_question,
            retrieved_context=retrieved_context,
        )

        headers = {
            "Authorization": f"Bearer {api_key.strip()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        payload: Dict[str, Any] = {
            "model": self.model_name,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    self.completions_url,
                    headers=headers,
                    json=payload,
                )
        except httpx.TimeoutException as exc:
            raise ServiceTimeoutError(
                f"Groq completions API request timed out after {self.timeout}s"
            ) from exc
        except httpx.RequestError as exc:
            raise APIResponseError(
                f"Groq completions API connection failed: {type(exc).__name__}"
            ) from exc

        if not response.is_success:
            self._handle_error_response(response, api_key)

        try:
            body = response.json()
        except Exception as exc:
            raise InvalidResponseError("Groq API response is not valid JSON") from exc

        if not isinstance(body, dict):
            raise InvalidResponseError("Malformed Groq API response: expected JSON object")

        choices = body.get("choices")
        if not choices or not isinstance(choices, list) or len(choices) == 0:
            raise InvalidResponseError("Malformed Groq API response: Missing or empty 'choices' list")

        first_choice = choices[0]
        if not isinstance(first_choice, dict):
            raise InvalidResponseError("Malformed Groq API response: Choice item is not an object")

        message = first_choice.get("message")
        if not isinstance(message, dict):
            raise InvalidResponseError("Malformed Groq API response: Choice missing 'message' object")

        content = message.get("content")
        if content is None or not isinstance(content, str):
            raise InvalidResponseError("Malformed Groq API response: Message missing text 'content'")

        return content

    def _build_messages(
        self,
        system_instruction: str,
        user_question: str,
        retrieved_context: Optional[Union[str, List[str]]] = None,
    ) -> List[Dict[str, str]]:
        messages = [
            {"role": "system", "content": system_instruction.strip()}
        ]

        # Format context cleanly if supplied
        context_str = ""
        if isinstance(retrieved_context, list):
            context_str = "\n\n".join(str(c).strip() for c in retrieved_context if c).strip()
        elif isinstance(retrieved_context, str):
            context_str = retrieved_context.strip()

        if context_str:
            user_content = f"Context:\n{context_str}\n\nQuestion:\n{user_question.strip()}"
        else:
            user_content = user_question.strip()

        messages.append({"role": "user", "content": user_content})
        return messages

    def _handle_error_response(self, response: httpx.Response, api_key: str) -> None:
        safe_detail = self._extract_safe_detail(response, api_key)
        code = response.status_code

        if code in (401, 403):
            raise AuthenticationError(
                f"Groq API Authentication failed (HTTP {code}): {safe_detail}"
            )
        elif code == 429:
            raise RateLimitError(
                f"Groq API Rate limit exceeded (HTTP 429): {safe_detail}"
            )
        else:
            raise APIResponseError(
                f"Groq API error (HTTP {code}): {safe_detail}",
                status_code=code,
            )

    @staticmethod
    def _extract_safe_detail(response: httpx.Response, secret: Optional[str] = None) -> str:
        try:
            data = response.json()
            if isinstance(data, dict):
                error_field = data.get("error")
                if isinstance(error_field, dict):
                    msg = str(error_field.get("message") or error_field)
                elif error_field:
                    msg = str(error_field)
                else:
                    msg = str(data.get("detail") or data.get("message") or response.text[:200])
            else:
                msg = response.text[:200]
        except Exception:
            msg = response.text[:200] if response.text else "No response body"

        if secret and secret in msg:
            msg = msg.replace(secret, "[REDACTED]")

        cleaned = " ".join(msg.split())
        return cleaned[:300]
