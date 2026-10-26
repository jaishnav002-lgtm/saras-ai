"""
Exceptions for Saras AI backend services (Nemotron embeddings & Groq generation).
Designed to provide clear diagnostic information without exposing secrets.
"""

class RAGServiceError(Exception):
    """Base exception for all RAG and AI service errors."""
    pass


class AuthenticationError(RAGServiceError):
    """Raised when authentication or authorization fails (e.g. HTTP 401 or 403, or missing key)."""
    pass


class RateLimitError(RAGServiceError):
    """Raised when an upstream API rate limit is exceeded (HTTP 429)."""
    pass


class ServiceTimeoutError(RAGServiceError):
    """Raised when an upstream API request times out."""
    pass


class InvalidResponseError(RAGServiceError):
    """Raised when an API response payload is malformed, missing required fields, or violates vector constraints."""
    pass


class APIResponseError(RAGServiceError):
    """Raised on other unsuccessful HTTP responses from upstream APIs."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class IngestionError(RAGServiceError):
    """Base exception for document chunking and ingestion errors."""
    pass


class UnextractableDocumentError(IngestionError):
    """Raised when an uploaded document has no extractable text."""
    pass
