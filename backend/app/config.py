import os
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://saras:saras_password@localhost:5432/saras_ai",
    )
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "dev-secret-change-me")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    jwt_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
    upload_dir: str = os.getenv("UPLOAD_DIR", "uploads")
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "20"))

    # NVIDIA Nemotron embeddings
    nvidia_api_key: Optional[str] = os.getenv("NVIDIA_API_KEY")
    nvidia_embedding_url: str = os.getenv(
        "NVIDIA_EMBEDDING_URL",
        "https://integrate.api.nvidia.com/v1/embeddings",
    )
    nvidia_embedding_model: str = os.getenv(
        "NVIDIA_EMBEDDING_MODEL",
        "nvidia/nemotron-3-embed-1b",
    )

    # NVIDIA NIM answer generation. Kept separate from NVIDIA embeddings.
    nvidia_generation_api_key: Optional[str] = os.getenv("NVIDIA_GENERATION_API_KEY")
    nvidia_generation_url: str = os.getenv(
        "NVIDIA_GENERATION_URL", "https://integrate.api.nvidia.com/v1/chat/completions"
    )
    nvidia_generation_model: str = os.getenv(
        "NVIDIA_GENERATION_MODEL", "google/gemma-4-31b-it"
    )

    # Retained only for the legacy Gemini client; answer generation uses NVIDIA NIM.
    gemini_api_key: Optional[str] = os.getenv("GEMINI_API_KEY")
    gemini_api_base_url: str = os.getenv(
        "GEMINI_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
    )
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    # Retained only for the legacy client; answer generation uses NVIDIA NIM.
    groq_api_key: Optional[str] = os.getenv("GROQ_API_KEY")
    groq_base_url: str = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    groq_model: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")

    # Document Ingestion / Chunking
    rag_chunk_size: int = int(os.getenv("RAG_CHUNK_SIZE", "1000"))
    rag_chunk_overlap: int = int(os.getenv("RAG_CHUNK_OVERLAP", "100"))

    # Vector Index & Cache
    rag_index_dir: str = os.getenv("RAG_INDEX_DIR", "data/indices")
    rag_embedding_cache_enabled: bool = (
        os.getenv("RAG_EMBEDDING_CACHE_ENABLED", "true").lower() in ("true", "1", "yes")
    )
    rag_embedding_version: str = os.getenv("RAG_EMBEDDING_VERSION", "v1")
    rag_max_retries: int = int(os.getenv("RAG_MAX_RETRIES", "3"))
    rag_retry_delay: float = float(os.getenv("RAG_RETRY_DELAY", "0.5"))
    rag_top_k: int = int(os.getenv("RAG_TOP_K", "8"))
    rag_rrf_k: int = int(os.getenv("RAG_RRF_K", "60"))
    rag_retrieval_cache_ttl_seconds: int = int(
        os.getenv("RAG_RETRIEVAL_CACHE_TTL_SECONDS", "600")
    )
    rag_answer_cache_ttl_seconds: int = int(
        os.getenv("RAG_ANSWER_CACHE_TTL_SECONDS", "900")
    )
    rag_answer_prompt_version: str = os.getenv("RAG_ANSWER_PROMPT_VERSION", "v1")
    rag_answer_temperature: float = float(os.getenv("RAG_ANSWER_TEMPERATURE", "0.2"))
    rag_answer_max_tokens: int = int(os.getenv("RAG_ANSWER_MAX_TOKENS", "800"))

    class Config:

        env_file = ".env"
        extra = "ignore"


settings = Settings()
