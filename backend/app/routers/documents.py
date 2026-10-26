import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.auth import get_current_user
from app.config import settings
from app.routers.subjects import get_owned_subject
from app.extraction import extract_text
from app.services.ingestion import DocumentIngestionService
from app.services.indexing import DocumentEmbeddingIndexer
from app.services.exceptions import UnextractableDocumentError
from app.services.retrieval_cache import RetrievalCache
from app.services.answer_cache import AnswerCache

router = APIRouter(tags=["documents"])

ALLOWED_TYPES = {"pdf", "pptx", "docx"}


def _ensure_upload_dir(subject_id: str) -> str:
    path = os.path.join(settings.upload_dir, subject_id)
    os.makedirs(path, exist_ok=True)
    return path


@router.get("/api/subjects/{subject_id}/documents", response_model=list[schemas.DocumentOut])
def list_documents(
    subject_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    get_owned_subject(subject_id, db, current_user)
    docs = (
        db.query(models.Document)
        .filter(models.Document.subject_id == subject_id)
        .order_by(models.Document.uploaded_at.desc())
        .all()
    )
    return docs


@router.post("/api/subjects/{subject_id}/documents", response_model=schemas.DocumentOut)
def upload_document(
    subject_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    subject = get_owned_subject(subject_id, db, current_user)

    ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "").lower()
    if ext not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400, detail=f"Unsupported file type '.{ext}'. Allowed: pdf, pptx, docx"
        )

    contents = file.file.read()
    size_mb = len(contents) / (1024 * 1024)
    if size_mb > settings.max_upload_mb:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({size_mb:.1f} MB). Max is {settings.max_upload_mb} MB.",
        )

    upload_dir = _ensure_upload_dir(subject.id)
    stored_name = f"{uuid.uuid4()}.{ext}"
    storage_path = os.path.join(upload_dir, stored_name)
    with open(storage_path, "wb") as f:
        f.write(contents)

    document = models.Document(
        subject_id=subject.id,
        filename=file.filename,
        file_type=ext,
        storage_path=storage_path,
        status="processing",
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    # Synchronous extraction and RAG chunk ingestion. Indexing is deliberately
    # a separate stage: a transient provider failure must not discard usable
    # extracted chunks, which the idempotent backfill can index later.
    try:
        result = extract_text(storage_path, ext)
        if not result.has_extractable_text():
            raise UnextractableDocumentError(
                f"Document '{file.filename}' contains no extractable text. "
                f"The file may be empty or contain only scanned images without OCR text."
            )
        document.status = "processed"
        document.page_or_slide_count = result.unit_count
        document.extracted_preview = result.full_text[:1000]
        document.extracted_text = result.full_text

        # Ingest chunks with metadata retention and idempotency
        ingestion_service = DocumentIngestionService()
        chunks = ingestion_service.ingest_document(
            document=document,
            db=db,
            extraction_result=result,
            owner_id=current_user.id,
        )
    except Exception as exc:  # noqa: BLE001
        document.status = "failed"
        document.error_message = str(exc)
    else:
        try:
            # Incrementally index only missing or changed stable chunks. The
            # indexer reuses the persistent embedding cache and does not rebuild.
            DocumentEmbeddingIndexer().index_chunks(chunks, db)
        except Exception as exc:  # noqa: BLE001
            # Keep extraction successful and chunks pending for safe backfill.
            document.status = "processed"
            document.error_message = f"Indexing pending: {str(exc)}"

    db.commit()
    db.refresh(document)
    return document
@router.get("/api/documents/{document_id}", response_model=schemas.DocumentOut)
def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    document = db.query(models.Document).filter(models.Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    # Ownership check via parent subject
    get_owned_subject(document.subject_id, db, current_user)

    # Lazily populate extracted_text if it was missing from older uploads
    if not document.extracted_text and os.path.exists(document.storage_path):
        try:
            res = extract_text(document.storage_path, document.file_type)
            document.extracted_text = res.full_text
            if not document.page_or_slide_count:
                document.page_or_slide_count = res.unit_count
            db.commit()
            db.refresh(document)
        except Exception:
            pass

    return document


@router.get("/api/documents/{document_id}/file")
def get_document_file(
    document_id: str,
    download: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    import mimetypes
    from fastapi.responses import FileResponse

    document = db.query(models.Document).filter(models.Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    # Ownership check via parent subject
    get_owned_subject(document.subject_id, db, current_user)

    if not os.path.exists(document.storage_path):
        raise HTTPException(status_code=404, detail="File not found on storage")

    mime_type, _ = mimetypes.guess_type(document.filename)
    if not mime_type:
        if document.file_type == "pdf":
            mime_type = "application/pdf"
        elif document.file_type == "docx":
            mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif document.file_type == "pptx":
            mime_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        else:
            mime_type = "application/octet-stream"

    content_disposition_type = "attachment" if download else ("inline" if document.file_type == "pdf" else "attachment")

    return FileResponse(
        path=document.storage_path,
        filename=document.filename,
        media_type=mime_type,
        content_disposition_type=content_disposition_type,
    )


@router.get("/api/documents/{document_id}/slides")
def get_document_slides(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    from app.pptx_renderer import parse_pptx_slides

    document = db.query(models.Document).filter(models.Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    # Ownership check via parent subject
    get_owned_subject(document.subject_id, db, current_user)

    if document.file_type != "pptx":
        raise HTTPException(status_code=400, detail="Slides visual parsing is only available for PPTX files")

    if not os.path.exists(document.storage_path):
        raise HTTPException(status_code=404, detail="File not found on storage")

    try:
        data = parse_pptx_slides(document.storage_path)
        data["document_id"] = document.id
        data["filename"] = document.filename
        return data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse presentation: {str(exc)}")


@router.delete("/api/documents/{document_id}")
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    document = db.query(models.Document).filter(models.Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    # Ownership check via parent subject
    get_owned_subject(document.subject_id, db, current_user)

    # Remove persisted vectors while chunk IDs are still available. This does
    # not make an inference request and is safe when the document was never indexed.
    chunk_ids = [chunk.id for chunk in document.chunks]
    if chunk_ids:
        DocumentEmbeddingIndexer().remove_chunks(document.subject_id, chunk_ids)
    RetrievalCache().invalidate_subject(db, document.subject_id)
    AnswerCache().invalidate_subject(db, document.subject_id)

    if os.path.exists(document.storage_path):
        os.remove(document.storage_path)

    db.delete(document)
    db.commit()
    return {"detail": "Document deleted"}
