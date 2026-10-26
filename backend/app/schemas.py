import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


# ---- Auth ----
class SignupRequest(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    created_at: datetime.datetime

    class Config:
        from_attributes = True


# ---- Subjects ----
class SubjectCreate(BaseModel):
    name: str = Field(min_length=1)
    description: Optional[str] = None


class SubjectOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    created_at: datetime.datetime
    document_count: int = 0
    last_activity: Optional[datetime.datetime] = None

    class Config:
        from_attributes = True


# ---- Documents ----
class DocumentOut(BaseModel):
    id: str
    subject_id: str
    filename: str
    file_type: str
    status: str
    page_or_slide_count: Optional[int]
    extracted_preview: Optional[str]
    extracted_text: Optional[str] = None
    error_message: Optional[str]
    uploaded_at: datetime.datetime

    class Config:
        from_attributes = True


class RetrievalRequest(BaseModel):
    question: str = Field(min_length=1, max_length=10000)
    top_k: Optional[int] = Field(default=None, ge=1, le=100)


class RetrievalChunkOut(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    page_number: Optional[int]
    chunk_index: int
    content: str
    score: float
    semantic_rank: Optional[int] = None
    keyword_rank: Optional[int] = None


class RetrievalResponse(BaseModel):
    results: List[RetrievalChunkOut]
    cached: bool = False


class AnswerRequest(RetrievalRequest):
    pass


class AnswerSourceOut(BaseModel):
    chunk_id: str
    document_id: str
    subject_id: str
    filename: str
    page_number: Optional[int]


class GroundedAnswerResponse(BaseModel):
    answer: str
    sources: List[AnswerSourceOut]
    cached: bool = False


# ---- Timetable import ----
class ExamConfidence(BaseModel):
    subject: Optional[float] = None
    date: Optional[float] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    venue: Optional[float] = None
    overall: Optional[float] = None


class ExamEntry(BaseModel):
    subject: str = ""
    date: Optional[str] = None  # ISO date, never inferred from the current year
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    venue: Optional[str] = None
    subject_id: Optional[str] = None
    confidence: Optional[ExamConfidence] = None
    warnings: List[str] = []
    source_page: Optional[int] = None


class TimetableExtractionOut(BaseModel):
    entries: List[ExamEntry]
    warnings: List[str] = []
    ocr_item_count: int = 0


class TimetableConfirmRequest(BaseModel):
    entries: List[ExamEntry]


class TimetableConfirmOut(BaseModel):
    batch_id: str
    entries: List[ExamEntry]
