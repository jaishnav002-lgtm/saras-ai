import math
import time
from typing import Any, Dict, List, Literal, Optional, Union

import httpx

from app.config import Settings, settings as global_settings
from app.services.embedding_cache import (
    BaseEmbeddingCache,
    SQLEmbeddingCache,
    compute_cache_key,
)
from app.services.exceptions import (
    APIResponseError,
    AuthenticationError,
    InvalidResponseError,
    RateLimitError,
    ServiceTimeoutError,
)


class NemotronEmbeddingService:
    """
    Modular client for NVIDIA Nemotron Embeddings (e.g., nvidia/nemotron-3-embed-1b).
    Supports passage and query embedding, batching, response structure validation,
    dynamic vector dimension detection, retry with backoff, and caching.
    """

    def __init__(
        self,
        settings: Optional[Settings] = None,
        timeout: float = 60.0,
        max_batch_size: int = 32,
        max_retries: Optional[int] = None,
        retry_delay: Optional[float] = None,
        cache: Optional[BaseEmbeddingCache] = None,
    ):
        self.settings = settings or global_settings
        self.timeout = timeout
        self.max_batch_size = max_batch_size
        self.max_retries = max_retries if max_retries is not None else getattr(self.settings, "rag_max_retries", 3)
        self.retry_delay = retry_delay if retry_delay is not None else getattr(self.settings, "rag_retry_delay", 0.5)
        self.cache = cache
        self.detected_dim: Optional[int] = None

    @property
    def api_key(self) -> Optional[str]:
        return self.settings.nvidia_api_key

    @property
    def endpoint_url(self) -> str:
        return self.settings.nvidia_embedding_url

    @property
    def model_name(self) -> str:
        return self.settings.nvidia_embedding_model

    def embed_passages(
        self,
        texts: List[str],
        use_cache: Optional[bool] = None,
        db: Optional[Any] = None,
    ) -> List[List[float]]:
        """
        Embeds document chunk passages with input_type='passage'.
        """
        return self.embed(texts, input_type="passage", use_cache=use_cache, db=db)

    def embed_query(
        self,
        text: str,
        use_cache: Optional[bool] = None,
        db: Optional[Any] = None,
    ) -> List[float]:
        """
        Embeds a user search or chat query with input_type='query'.
        Returns a single vector.
        """
        results = self.embed([text], input_type="query", use_cache=use_cache, db=db)
        if not results:
            raise InvalidResponseError("No embedding vector returned for query.")
        return results[0]

    def embed(
        self,
        texts: Union[str, List[str]],
        input_type: Literal["passage", "query"] = "passage",
        use_cache: Optional[bool] = None,
        db: Optional[Any] = None,
    ) -> List[List[float]]:
        """
        Batches and embeds text inputs, returning validated list of float vectors.
        Optionally uses caching when enabled.
        """
        if isinstance(texts, str):
            input_list = [texts]
        else:
            input_list = list(texts)

        if not input_list:
            return []

        if input_type not in ("passage", "query"):
            raise ValueError(f"Invalid input_type '{input_type}'. Must be 'passage' or 'query'.")

        # Determine cache to use
        cache_to_use: Optional[BaseEmbeddingCache] = self.cache
        if cache_to_use is None and db is not None and getattr(self.settings, "rag_embedding_cache_enabled", True):
            cache_to_use = SQLEmbeddingCache(db=db)

        # Decide whether caching is active for this call
        should_cache = use_cache if use_cache is not None else (
            cache_to_use is not None and getattr(self.settings, "rag_embedding_cache_enabled", True)
        )

        if not should_cache or cache_to_use is None:
            return self._embed_uncached(input_list, input_type=input_type)

        return self._embed_with_cache(input_list, input_type=input_type, cache=cache_to_use)

    def _embed_with_cache(
        self,
        input_list: List[str],
        input_type: Literal["passage", "query"],
        cache: BaseEmbeddingCache,
    ) -> List[List[float]]:
        version = getattr(self.settings, "rag_embedding_version", "v1")
        keys = [
            compute_cache_key(
                content=t,
                model=self.model_name,
                input_type=input_type,
                version=version,
            )
            for t in input_list
        ]

        cached_dict = cache.get_batch(keys)

        # If any cached vectors exist, update detected_dim if not yet set
        for vec in cached_dict.values():
            if self.detected_dim is None and isinstance(vec, list) and len(vec) > 0:
                self.detected_dim = len(vec)
            break

        miss_indices = [idx for idx, k in enumerate(keys) if k not in cached_dict]

        if not miss_indices:
            return [cached_dict[k] for k in keys]

        # Embed missing items
        miss_texts = [input_list[i] for i in miss_indices]
        new_vectors = self._embed_uncached(miss_texts, input_type=input_type)

        # Save new valid vectors to cache
        items_to_cache = {
            keys[idx]: vec
            for idx, vec in zip(miss_indices, new_vectors)
        }
        cache.set_batch(
            items=items_to_cache,
            model=self.model_name,
            input_type=input_type,
            version=version,
        )

        # Reassemble the vectors in original order
        results: List[Optional[List[float]]] = [None] * len(input_list)
        for idx, k in enumerate(keys):
            if k in cached_dict:
                results[idx] = cached_dict[k]
        for idx, vec in zip(miss_indices, new_vectors):
            results[idx] = vec

        return [v for v in results if v is not None]

    def _embed_uncached(
        self,
        input_list: List[str],
        input_type: Literal["passage", "query"],
    ) -> List[List[float]]:
        api_key = self.api_key
        if not api_key or not api_key.strip():
            raise AuthenticationError("NVIDIA_API_KEY is not configured or is empty.")

        all_vectors: List[List[float]] = []
        expected_dim: Optional[int] = self.detected_dim

        # Process in batches respecting max_batch_size
        for i in range(0, len(input_list), self.max_batch_size):
            batch = input_list[i : i + self.max_batch_size]
            batch_vectors = self._send_batch_request(
                batch=batch,
                input_type=input_type,
                api_key=api_key.strip(),
            )

            # Validate dimensions and values
            expected_dim = self._validate_vectors(
                batch_vectors=batch_vectors,
                batch_size=len(batch),
                expected_dim=expected_dim,
            )

            all_vectors.extend(batch_vectors)

        return all_vectors

    def _backoff(self, attempt: int) -> None:
        if self.retry_delay > 0:
            delay = self.retry_delay * (2 ** attempt)
            time.sleep(delay)

    def _send_batch_request(
        self,
        batch: List[str],
        input_type: str,
        api_key: str,
    ) -> List[List[float]]:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model_name,
            "input": batch,
            "input_type": input_type,
        }

        last_exception: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(
                        self.endpoint_url,
                        headers=headers,
                        json=payload,
                    )
            except httpx.TimeoutException as exc:
                last_exception = ServiceTimeoutError(
                    f"NVIDIA embeddings API request timed out after {self.timeout}s"
                )
                if attempt < self.max_retries:
                    self._backoff(attempt)
                    continue
                raise last_exception from exc
            except httpx.RequestError as exc:
                last_exception = APIResponseError(
                    f"NVIDIA embeddings API connection failed: {type(exc).__name__}"
                )
                if attempt < self.max_retries:
                    self._backoff(attempt)
                    continue
                raise last_exception from exc

            # Check response status
            if not response.is_success:
                code = response.status_code
                safe_detail = self._extract_safe_detail(response, api_key)
                if code in (401, 403):
                    raise AuthenticationError(
                        f"NVIDIA API Authentication failed (HTTP {code}): {safe_detail}"
                    )
                elif code == 429:
                    last_exception = RateLimitError(
                        f"NVIDIA API Rate limit exceeded (HTTP 429): {safe_detail}"
                    )
                    if attempt < self.max_retries:
                        self._backoff(attempt)
                        continue
                    raise last_exception
                elif code in (500, 502, 503, 504):
                    last_exception = APIResponseError(
                        f"NVIDIA API error (HTTP {code}): {safe_detail}",
                        status_code=code,
                    )
                    if attempt < self.max_retries:
                        self._backoff(attempt)
                        continue
                    raise last_exception
                else:
                    raise APIResponseError(
                        f"NVIDIA API error (HTTP {code}): {safe_detail}",
                        status_code=code,
                    )

            # If response is successful, parse and return
            return self._parse_successful_response(response, batch)

        if last_exception:
            raise last_exception
        raise APIResponseError("NVIDIA API request failed after retries")

    def _parse_successful_response(
        self,
        response: httpx.Response,
        batch: List[str],
    ) -> List[List[float]]:
        try:
            body = response.json()
        except Exception as exc:
            raise InvalidResponseError("NVIDIA API response is not valid JSON") from exc

        if not isinstance(body, dict):
            raise InvalidResponseError("Malformed NVIDIA API response: expected JSON object")

        raw_data = body.get("data")
        if not isinstance(raw_data, list):
            raise InvalidResponseError("Malformed NVIDIA API response: Missing 'data' field in response")

        if len(raw_data) != len(batch):
            raise InvalidResponseError(
                f"Count mismatch: sent {len(batch)} inputs, received {len(raw_data)} embeddings"
            )

        # Ensure strict response ordering if index is provided
        if all(isinstance(item, dict) and "index" in item for item in raw_data):
            ordered_items = sorted(raw_data, key=lambda x: x["index"])
        else:
            ordered_items = raw_data

        vectors: List[List[float]] = []
        for idx, item in enumerate(ordered_items):
            if not isinstance(item, dict) or "embedding" not in item:
                raise InvalidResponseError(f"Missing 'embedding' in response item at index {idx}")
            vectors.append(item["embedding"])

        return vectors

    def _validate_vectors(
        self,
        batch_vectors: List[List[float]],
        batch_size: int,
        expected_dim: Optional[int],
    ) -> int:
        if len(batch_vectors) != batch_size:
            raise InvalidResponseError(
                f"Expected {batch_size} vectors, received {len(batch_vectors)}"
            )

        current_dim = expected_dim if expected_dim is not None else self.detected_dim
        for i, vec in enumerate(batch_vectors):
            if not isinstance(vec, list) or len(vec) == 0:
                raise InvalidResponseError(f"Vector at index {i} is empty or not a list")

            vec_len = len(vec)
            if current_dim is None:
                current_dim = vec_len
                self.detected_dim = vec_len
            elif vec_len != current_dim:
                raise InvalidResponseError(
                    f"Inconsistent vector dimension: expected {current_dim}, got {vec_len} at index {i}"
                )

            for j, val in enumerate(vec):
                # Ensure strictly numeric and finite (reject bools which inherit int)
                if isinstance(val, bool) or not isinstance(val, (int, float)) or not math.isfinite(val):
                    raise InvalidResponseError(
                        f"Vector contains non-numeric or non-finite value at index {i}, position {j}"
                    )

        if self.detected_dim is None and current_dim is not None:
            self.detected_dim = current_dim

        return current_dim or 0

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
                data_err = data.get("error")
            else:
                msg = response.text[:200]
        except Exception:
            msg = response.text[:200] if response.text else "No response body"

        # Sanitize to never leak secret
        if secret and secret in msg:
            msg = msg.replace(secret, "[REDACTED]")

        # Clean whitespace and truncate
        cleaned = " ".join(msg.split())
        return cleaned[:300]
